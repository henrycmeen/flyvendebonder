(() => {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const root = document.querySelector(".page");
  if (!root) return;

  const rootStyle = document.documentElement.style;
  const ease = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
  const brand = document.querySelector(".brand");
  const brandLogo = document.querySelector(".brand__logo");
  let introAnimation = null;
  let hoverAnimation = null;
  let settleAnimation = null;

  const cancelAnimation = (anim) => {
    try {
      anim?.cancel();
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

  const startIntroSpin = () => {
    if (prefersReducedMotion || !brandLogo) return;
    cancelAnimation(introAnimation);
    cancelAnimation(hoverAnimation);
    cancelAnimation(settleAnimation);
    hoverAnimation = null;
    settleAnimation = null;

    const start = getRotationDegrees();
    introAnimation = brandLogo.animate(
      [
        { transform: `rotate(${start}deg)` },
        { transform: `rotate(${start + 320}deg)`, offset: 0.7 },
        { transform: `rotate(${start + 360}deg)` },
      ],
      { duration: 5000, easing: ease, fill: "forwards" },
    );
    introAnimation.finished?.catch(() => {});
  };

  const startHoverSpin = () => {
    if (prefersReducedMotion || !brandLogo) return;
    cancelAnimation(settleAnimation);
    settleAnimation = null;

    cancelAnimation(introAnimation);
    introAnimation = null;

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
    // Hvis vi allerede er "nesten ferdig", ta en ekstra runde så avslutningen føles myk.
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

  const markLoaded = () => {
    root.classList.add("is-loaded");

    if (prefersReducedMotion) {
      return;
    }

    startIntroSpin();
  };

  const start = () => window.requestAnimationFrame(markLoaded);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  if (!prefersReducedMotion && brand && brandLogo) {
    brand.addEventListener("pointerenter", startHoverSpin);
    brand.addEventListener("pointerleave", stopHoverSpin);
    brand.addEventListener("focusin", startHoverSpin);
    brand.addEventListener("focusout", stopHoverSpin);
  }

  if (!prefersReducedMotion) {
    let raf = 0;
    const updateScroll = () => {
      const y = window.scrollY || window.pageYOffset || 0;
      const t = Math.min(1, y / 140);
      rootStyle.setProperty("--scroll-t", t.toFixed(3));
      rootStyle.setProperty("--scroll-rotate", (y * 1.1).toFixed(2));
      const videoT = Math.min(1, y / 90);
      rootStyle.setProperty("--video-t", videoT.toFixed(3));

      if (window.innerWidth <= 1300) {
        const mobileT = Math.min(1, y / 180);
        rootStyle.setProperty("--mobile-t", mobileT.toFixed(3));
      } else {
        rootStyle.setProperty("--mobile-t", "0");
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        updateScroll();
      });
    };

    updateScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  }
})();
