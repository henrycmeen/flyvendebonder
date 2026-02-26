(() => {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const root = document.querySelector(".page");
  const snap = document.getElementById("snap");
  const brand = document.querySelector(".brand--floating");
  const brandLogo = document.querySelector(".brand--floating .brand__logo");
  const brandTitle = document.getElementById("plan-title");
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
  let lastScrollY = 0;
  let lastScrollTime = performance.now();
  let brandRaf = 0;
  let isBrandDragging = false;
  let brandPointerId = null;
  let suppressBrandClickUntil = 0;
  let releaseSpinVelocity = 0;
  let logoWeightImpulse = 0;
  let logoWeightValue = 0;
  const dragStart = { x: 0, y: 0, time: 0 };
  const dragLast = { x: 0, y: 0, time: 0, vx: 0, vy: 0 };
  const brandState = {
    x: 0,
    y: 0,
    rotate: 0,
    scale: 1,
    shellY: 0,
    shellTilt: 0,
    stretchX: 1,
    stretchY: 1,
    blur: 0,
  };
  const brandTarget = {
    x: 0,
    y: 0,
    rotate: 0,
    scale: 1,
    shellY: 0,
    shellTilt: 0,
    stretchX: 1,
    stretchY: 1,
    blur: 0,
  };

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
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

  const readBrandStroke = () => {
    if (!brand) return 44;
    const raw = window.getComputedStyle(brand).getPropertyValue("--logo-stroke").trim();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return 44;
    return parsed;
  };

  const logoStrokeRegular = readBrandStroke();
  const logoStrokeBold = logoStrokeRegular + 12;

  const setLogoStroke = (px) => {
    if (!brand) return;
    brand.style.setProperty("--logo-stroke", `${px.toFixed(2)}px`);
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

  const writeBrandVars = () => {
    rootStyle.setProperty("--brand-drag-x", `${brandState.x.toFixed(2)}px`);
    rootStyle.setProperty("--brand-drag-y", `${brandState.y.toFixed(2)}px`);
    rootStyle.setProperty("--brand-drag-rotate", `${brandState.rotate.toFixed(2)}deg`);
    rootStyle.setProperty("--brand-drag-scale", brandState.scale.toFixed(4));
    rootStyle.setProperty("--brand-shell-y", `${brandState.shellY.toFixed(2)}px`);
    rootStyle.setProperty("--brand-shell-tilt", `${brandState.shellTilt.toFixed(2)}deg`);
    rootStyle.setProperty("--brand-stretch-x", brandState.stretchX.toFixed(4));
    rootStyle.setProperty("--brand-stretch-y", brandState.stretchY.toFixed(4));
    rootStyle.setProperty("--brand-stretch-blur", `${brandState.blur.toFixed(3)}px`);
  };

  const applyReleaseImpulse = (vx, vy) => {
    const speed = Math.hypot(vx, vy);
    const impulseScale = clamp(speed * 220, 0, 24);
    brandTarget.x = clamp(brandTarget.x + vx * 160, -22, 22);
    brandTarget.y = clamp(brandTarget.y + vy * 160, -22, 22);
    brandTarget.shellY = clamp(brandTarget.shellY + vy * 42, -10, 10);
    brandTarget.shellTilt = clamp(brandTarget.shellTilt + vx * -20, -10, 10);
    brandTarget.scale = clamp(1 + speed * 0.04, 1, 1.08);
    brandTarget.stretchX = clamp(1 + speed * 0.12, 1, 1.18);
    brandTarget.stretchY = clamp(1 + speed * 0.16, 1, 1.22);
    brandTarget.blur = clamp(speed * 0.6, 0, 1.2);
    releaseSpinVelocity = clamp(
      releaseSpinVelocity + vx * 28 - vy * 10 + (vx >= 0 ? 1 : -1) * impulseScale,
      -36,
      36,
    );
    logoWeightImpulse = Math.max(logoWeightImpulse, clamp(speed * 0.9, 0, 1));
  };

  const pushBrandByScroll = (y, h) => {
    if (prefersReducedMotion || !brand || isBrandDragging) return;

    const now = performance.now();
    const dt = Math.max(16, now - lastScrollTime);
    const dy = y - lastScrollY;
    const velocity = clamp(dy / dt, -2.4, 2.4);
    const absVelocity = Math.abs(velocity);
    const progress = clamp01(y / Math.max(h * 0.9, 1));

    brandTarget.x = clamp(brandTarget.x + velocity * -5.2, -10, 10);
    brandTarget.y = clamp(brandTarget.y + velocity * 9.4, -14, 14);
    brandTarget.rotate = clamp(brandTarget.rotate + velocity * -22, -28, 28);
    brandTarget.shellY = clamp(brandTarget.shellY + velocity * 3.4, -7, 7);
    brandTarget.shellTilt = clamp(brandTarget.shellTilt + velocity * -2.8, -6, 6);
    brandTarget.scale = clamp(1 + Math.abs(velocity) * 0.018 + progress * 0.01, 1, 1.07);
    brandTarget.stretchX = clamp(1 + absVelocity * 0.09, 1, 1.16);
    brandTarget.stretchY = clamp(1 + absVelocity * 0.2, 1, 1.32);
    brandTarget.blur = clamp(absVelocity * 0.55, 0, 1.1);
    logoWeightImpulse = Math.max(logoWeightImpulse, clamp((absVelocity - 0.08) / 0.85, 0, 1));

    lastScrollY = y;
    lastScrollTime = now;
  };

  const tickBrand = () => {
    if (prefersReducedMotion || !brand) return;

    logoWeightImpulse = clamp(
      logoWeightImpulse * 0.9 + Math.min(Math.abs(releaseSpinVelocity) / 46, 0.14),
      0,
      1,
    );
    logoWeightValue += (logoWeightImpulse - logoWeightValue) * 0.2;
    const approachT = Math.pow(clamp01(logoWeightValue), 0.85);
    const approachScale = 1 + approachT * 0.14;
    brandTarget.scale = Math.max(brandTarget.scale, approachScale);
    brandTarget.y = clamp(brandTarget.y - approachT * 0.45, -14, 14);
    brandTarget.blur = Math.max(brandTarget.blur, approachT * 0.9);

    brandState.x += (brandTarget.x - brandState.x) * 0.16;
    brandState.y += (brandTarget.y - brandState.y) * 0.16;
    brandState.rotate += (brandTarget.rotate - brandState.rotate) * 0.14;
    brandState.scale += (brandTarget.scale - brandState.scale) * 0.14;
    brandState.shellY += (brandTarget.shellY - brandState.shellY) * 0.14;
    brandState.shellTilt += (brandTarget.shellTilt - brandState.shellTilt) * 0.14;
    brandState.stretchX += (brandTarget.stretchX - brandState.stretchX) * 0.16;
    brandState.stretchY += (brandTarget.stretchY - brandState.stretchY) * 0.16;
    brandState.blur += (brandTarget.blur - brandState.blur) * 0.2;
    if (Math.abs(releaseSpinVelocity) > 0.01) {
      brandState.rotate = clamp(brandState.rotate + releaseSpinVelocity, -240, 240);
      releaseSpinVelocity *= 0.94;
    } else {
      releaseSpinVelocity = 0;
    }

    brandTarget.x *= 0.9;
    brandTarget.y *= 0.9;
    brandTarget.rotate *= 0.88;
    brandTarget.shellY *= 0.88;
    brandTarget.shellTilt *= 0.88;
    brandTarget.scale += (1 - brandTarget.scale) * 0.08;
    brandTarget.stretchX += (1 - brandTarget.stretchX) * 0.11;
    brandTarget.stretchY += (1 - brandTarget.stretchY) * 0.11;
    brandTarget.blur *= 0.82;
    setLogoStroke(lerp(logoStrokeRegular, logoStrokeBold, approachT));

    writeBrandVars();
    brandRaf = window.requestAnimationFrame(tickBrand);
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
    if (prefersReducedMotion || !brandLogo || isBrandDragging) return;
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
    if (prefersReducedMotion || !brandLogo || isBrandDragging) return;
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

    const scrollT = clamp01(y / Math.max(h * 0.68, 1));
    rootStyle.setProperty("--scroll-t", scrollT.toFixed(4));

    // Tydeligere scroll-rotasjon på logoen.
    const rotate = Math.round(y * 1.35 * 10) / 10;
    if (Math.abs(rotate - lastRotate) >= 0.1) {
      rootStyle.setProperty("--scroll-rotate", rotate.toFixed(1));
      lastRotate = rotate;
    }

    pushBrandByScroll(y, h);
  };

  const syncBrandAnchorToTitle = () => {
    if (!brand || !brandTitle) return;
    if ((snap.scrollTop || 0) > 4) return;

    const titleRect = brandTitle.getBoundingClientRect();
    const brandRect = brand.getBoundingClientRect();
    const targetTop = Math.max(
      8,
      titleRect.top + (titleRect.height - brandRect.height) * 0.5,
    );
    rootStyle.setProperty("--brand-anchor-top", `${Math.round(targetTop)}px`);
  };

  const onBrandPointerDown = (event) => {
    if (prefersReducedMotion || !brand) return;
    brandPointerId = event.pointerId;
    isBrandDragging = true;
    brand.classList.add("is-dragging");
    dragStart.x = event.clientX;
    dragStart.y = event.clientY;
    dragStart.time = performance.now();
    dragLast.x = event.clientX;
    dragLast.y = event.clientY;
    dragLast.time = dragStart.time;
    dragLast.vx = 0;
    dragLast.vy = 0;
    releaseSpinVelocity = 0;
    cancelAnimation(hoverAnimation);
    hoverAnimation = null;
    cancelAnimation(settleAnimation);
    settleAnimation = null;
    try {
      brand.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const onBrandPointerMove = (event) => {
    if (!isBrandDragging || event.pointerId !== brandPointerId) return;
    const now = performance.now();
    const dt = Math.max(8, now - dragLast.time);
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    dragLast.vx = (event.clientX - dragLast.x) / dt;
    dragLast.vy = (event.clientY - dragLast.y) / dt;
    dragLast.x = event.clientX;
    dragLast.y = event.clientY;
    dragLast.time = now;

    const px = clamp(dx * 0.45, -26, 26);
    const py = clamp(dy * 0.45, -26, 26);
    const rotate = clamp(dx * 0.8 - dy * 0.45, -34, 34);

    brandState.x = brandTarget.x = px;
    brandState.y = brandTarget.y = py;
    brandState.rotate = brandTarget.rotate = rotate;
    brandState.scale = brandTarget.scale = clamp(1 + Math.hypot(px, py) * 0.0025, 1, 1.08);
    brandState.stretchX = brandTarget.stretchX = clamp(1 + Math.abs(dx) * 0.0022, 1, 1.16);
    brandState.stretchY = brandTarget.stretchY = clamp(1 + Math.abs(dy) * 0.0022, 1, 1.16);
    brandState.blur = brandTarget.blur = clamp(Math.hypot(dx, dy) * 0.005, 0, 1.1);
    writeBrandVars();
  };

  const releaseBrandDrag = (event) => {
    if (!isBrandDragging || event.pointerId !== brandPointerId) return;
    isBrandDragging = false;
    brandPointerId = null;
    if (brand) brand.classList.remove("is-dragging");
    try {
      brand?.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    applyReleaseImpulse(dragLast.vx, dragLast.vy);
    suppressBrandClickUntil = performance.now() + 260;
  };

  const onBrandClick = (event) => {
    if (performance.now() < suppressBrandClickUntil) {
      event.preventDefault();
      event.stopPropagation();
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
  syncBrandAnchorToTitle();
  snap.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    onScroll();
    window.requestAnimationFrame(syncBrandAnchorToTitle);
  });
  window.addEventListener("load", syncBrandAnchorToTitle, { once: true });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      syncBrandAnchorToTitle();
    });
  }
  if (!prefersReducedMotion && brand) {
    brandRaf = window.requestAnimationFrame(tickBrand);
  } else if (brandRaf) {
    window.cancelAnimationFrame(brandRaf);
    brandRaf = 0;
  }

  if (!prefersReducedMotion && brand && brandLogo) {
    brand.addEventListener("pointerenter", startHoverSpin);
    brand.addEventListener("pointerleave", stopHoverSpin);
    brand.addEventListener("focusin", startHoverSpin);
    brand.addEventListener("focusout", stopHoverSpin);
    brand.addEventListener("pointerdown", onBrandPointerDown);
    brand.addEventListener("pointermove", onBrandPointerMove);
    brand.addEventListener("pointerup", releaseBrandDrag);
    brand.addEventListener("pointercancel", releaseBrandDrag);
    brand.addEventListener("click", onBrandClick);
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

/* __fbSeasonBridge */
(() => {
  const root = document.documentElement;
  if (!root) return;

  const seasonFromMonth = (monthIndex) => {
    if (monthIndex >= 2 && monthIndex <= 4) return "spring";
    if (monthIndex >= 5 && monthIndex <= 7) return "summer";
    if (monthIndex >= 8 && monthIndex <= 10) return "autumn";
    return "winter";
  };

  const params = new URLSearchParams(window.location.search);
  const seasonParam = (params.get("season") || "").toLowerCase();
  const allowed = new Set(["all", "spring", "summer", "autumn", "winter"]);
  const fallback = seasonFromMonth(new Date().getMonth());
  root.dataset.season = allowed.has(seasonParam) ? seasonParam : fallback;
})();
