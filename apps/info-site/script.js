(() => {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const root = document.querySelector(".page");
  const snap = document.getElementById("snap");
  const brand = document.querySelector(".brand--floating");
  const brandLogo = document.querySelector(".brand--floating .brand__logo");
  const mediaFrame = document.querySelector("[data-media-frame]");
  const mediaVideo = document.querySelector(".proto-media__video");

  if (!root || !snap || !mediaFrame) return;

  const rootStyle = document.documentElement.style;

  const ease = "cubic-bezier(0.16, 0.9, 0.22, 1)";
  const isChromium = (() => {
    const ua = navigator.userAgent || "";
    return (
      (ua.includes("Chrome") || ua.includes("CriOS")) &&
      !ua.includes("Edg") &&
      !ua.includes("OPR")
    );
  })();
  let hoverAnimation = null;
  let settleAnimation = null;
  let lockedBanner = false;
  let wasLockedBanner = false;
  let lastMediaH = -1;
  let lastRotate = -1;
  let chromeVideoAutoPaused = false;

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

  const readFloatVar = (name, fallback) => {
    const raw = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
  };

  const readLockAspect = () => {
    const parsed = readFloatVar("--lock-aspect", 2.39);
    if (parsed <= 0.1) return 2.39;
    return parsed;
  };

  const cancelAnimation = (anim) => {
    try {
      anim?.cancel();
    } catch {
      // ignore
    }
  };

  const safePlayVideo = () => {
    if (!mediaVideo || prefersReducedMotion) return;
    try {
      const maybePromise = mediaVideo.play();
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch(() => {});
      }
    } catch {
      // ignore
    }
  };

  const getRotationDegrees = () => {
    if (!brandLogo) return 0;
    const transform = window.getComputedStyle(brandLogo).transform;
    if (!transform || transform === "none") return 0;
    const match = transform.match(/^matrix\\((.+)\\)$/);
    if (!match) return 0;
    const parts = match[1].split(",").map((p) => Number.parseFloat(p.trim()));
    if (parts.length < 2) return 0;
    const [a, b] = parts;
    let deg = Math.atan2(b, a) * (180 / Math.PI);
    if (Number.isNaN(deg)) return 0;
    if (deg < 0) deg += 360;
    return deg;
  };

  const startHoverSpin = () => {
    if (prefersReducedMotion || !brandLogo) return;
    cancelAnimation(settleAnimation);
    settleAnimation = null;

    const start = getRotationDegrees();
    cancelAnimation(hoverAnimation);
    hoverAnimation = brandLogo.animate(
      [
        { transform: `rotate(${start}deg)` },
        { transform: `rotate(${start + 360}deg)` },
      ],
      { duration: 900, iterations: Infinity, easing: "linear" },
    );
  };

  const stopHoverSpin = () => {
    if (prefersReducedMotion || !brandLogo) return;
    const start = getRotationDegrees();
    cancelAnimation(hoverAnimation);
    hoverAnimation = null;

    const normalized = ((start % 360) + 360) % 360;
    let remaining = (360 - normalized) % 360;
    if (remaining < 30) remaining += 360;
    const end = start + remaining;
    const duration = Math.round(320 + (remaining / 360) * 700);

    cancelAnimation(settleAnimation);
    settleAnimation = brandLogo.animate(
      [{ transform: `rotate(${start}deg)` }, { transform: `rotate(${end}deg)` }],
      { duration, easing: ease, fill: "forwards" },
    );
    settleAnimation.finished?.catch(() => {});
  };

  const markLoaded = () => root.classList.add("is-loaded");
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markLoaded, { once: true });
  } else {
    markLoaded();
  }

  const qs = new URLSearchParams(window.location.search);
  if (qs.get("bg") === "white") {
    document.documentElement.classList.add("bg-white");
  }

  const setVars = () => {
    const y = snap.scrollTop || 0;
    const h = Math.max(1, snap.clientHeight);
    const w = Math.max(1, snap.clientWidth);

    // Rask (men smooth) overgang fra full-bleed til et låst, bredt bannerformat.
    // Bredde: alltid full viewport (ingen side-margins).
    // Høyde: går fra “start”-høyde ned til en “låst” høyde tidlig i scrollen og holder seg der.
    const lockAspect = readLockAspect(); // f.eks 2.0 eller 2.39

    // Låst høyde: prøv å respektere aspect, men cap slik at tekst kommer fram på desktop.
    const aspectH = w / lockAspect;
    const lockMaxV = readFloatVar("--lock-max-v", 0.42);
    const lockH = Math.max(140, Math.min(aspectH, Math.max(0.18, lockMaxV) * h));

    // Hvor raskt den “låser”: mindre verdi = raskere.
    const shrinkV = readFloatVar("--shrink-v", 0.32);
    const shrinkDistance = Math.max(170, Math.min(Math.max(0.18, shrinkV) * h, 420));
    const lockEnter = shrinkDistance + (isChromium ? 20 : 10);
    const lockExit = shrinkDistance - (isChromium ? 60 : 24);
    if (!lockedBanner && y >= lockEnter) lockedBanner = true;
    if (lockedBanner && y <= lockExit) lockedBanner = false;
    const t = lockedBanner ? 1 : easeOutQuad(clamp01(y / shrinkDistance));

    if (isChromium && mediaVideo && wasLockedBanner !== lockedBanner) {
      if (lockedBanner) {
        if (!mediaVideo.paused) {
          mediaVideo.pause();
          chromeVideoAutoPaused = true;
        }
      } else if (chromeVideoAutoPaused) {
        safePlayVideo();
        chromeVideoAutoPaused = false;
      }
      wasLockedBanner = lockedBanner;
    }

    const startV = readFloatVar("--start-v", 0.8);
    const fullH = Math.max(220, Math.min(Math.max(0.55, startV) * h, 0.92 * h));
    const mediaH = lerp(fullH, lockH, t);

    rootStyle.setProperty("--media-w", "100vw");
    const roundedMediaH = Math.round(mediaH);
    if (Math.abs(roundedMediaH - lastMediaH) >= 1) {
      rootStyle.setProperty("--media-h", `${roundedMediaH}px`);
      lastMediaH = roundedMediaH;
    }
    rootStyle.setProperty("--media-radius", "0px");
    rootStyle.setProperty("--media-shadow-alpha", "0");

    // Logo spin basert på scroll.
    const rotate = Math.round(y * 1.1 * 10) / 10;
    if (Math.abs(rotate - lastRotate) >= 0.1) {
      rootStyle.setProperty("--scroll-rotate", rotate.toFixed(1));
      lastRotate = rotate;
    }
  };

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      setVars();
    });
  };

  setVars();
  snap.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  if (!prefersReducedMotion && brand && brandLogo) {
    brand.addEventListener("pointerenter", startHoverSpin);
    brand.addEventListener("pointerleave", stopHoverSpin);
    brand.addEventListener("focusin", startHoverSpin);
    brand.addEventListener("focusout", stopHoverSpin);
  }

  const onKey = (event) => {
    if (prefersReducedMotion) return;

    const jump = (dy) => {
      const next = Math.max(0, (snap.scrollTop || 0) + dy);
      snap.scrollTo({ top: next, behavior: "smooth" });
    };

    if (event.key === "PageDown") {
      event.preventDefault();
      jump(snap.clientHeight * 0.9);
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      jump(-snap.clientHeight * 0.9);
    }
  };

  window.addEventListener("keydown", onKey);
})();
