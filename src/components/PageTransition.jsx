"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { animate } from "animejs";

function shouldHandleLink(event, anchor) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    anchor.target ||
    anchor.hasAttribute("download")
  ) {
    return false;
  }

  const url = new URL(anchor.href);
  const current = new URL(window.location.href);

  if (url.origin !== current.origin) {
    return false;
  }

  if (url.pathname === current.pathname && url.search === current.search) {
    return false;
  }

  return true;
}

export function PageTransition({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const overlayRef = useRef(null);
  const contentRef = useRef(null);
  const isTransitioningRef = useRef(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const content = contentRef.current;
    const overlay = overlayRef.current;

    if (!content || !overlay) {
      return;
    }

    overlay.style.pointerEvents = "none";

    animate(overlay, {
      translateY: ["0%", "-105%"],
      scaleX: [1, 0.96],
      borderRadius: ["0px", "0 0 44px 44px"],
      duration: 620,
      ease: "inOutCubic",
    });

    const timer = window.setTimeout(() => {
      overlay.style.transform = "translateY(105%) scaleX(1)";
      overlay.style.borderRadius = "44px 44px 0 0";
      isTransitioningRef.current = false;
    }, 660);

    animate(content, {
      opacity: { from: 0 },
      translateY: { from: "1.1rem" },
      filter: ["blur(10px)", "blur(0px)"],
      duration: 560,
      delay: 90,
      ease: "outCubic",
    });

    return () => window.clearTimeout(timer);
  }, [pathname]);

  function handleClick(event) {
    const anchor = event.target.closest?.("a[href]");

    if (!anchor || !shouldHandleLink(event, anchor)) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    event.preventDefault();

    if (isTransitioningRef.current) {
      return;
    }

    const overlay = overlayRef.current;
    const content = contentRef.current;

    if (!overlay || !content) {
      router.push(anchor.pathname + anchor.search + anchor.hash);
      return;
    }

    isTransitioningRef.current = true;
    overlay.style.pointerEvents = "auto";

    animate(content, {
      opacity: 0,
      translateY: "-0.9rem",
      filter: "blur(8px)",
      duration: 260,
      ease: "inCubic",
    });

    animate(overlay, {
      translateY: ["105%", "0%"],
      scaleX: [0.94, 1],
      borderRadius: ["44px 44px 0 0", "0px"],
      duration: 520,
      ease: "inOutCubic",
    });

    window.setTimeout(() => {
      router.push(anchor.pathname + anchor.search + anchor.hash);
    }, 500);
  }

  return (
    <>
      <div className="page-transition-root" onClick={handleClick} ref={contentRef}>
        {children}
      </div>
      <div className="route-transition-layer" ref={overlayRef} aria-hidden="true">
        <span />
      </div>
    </>
  );
}
