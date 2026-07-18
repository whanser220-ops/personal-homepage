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
  const contentRef = useRef(null);
  const isTransitioningRef = useRef(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const content = contentRef.current;

    if (!content) {
      return;
    }

    isTransitioningRef.current = false;
    document.documentElement.classList.remove("is-route-changing");
    content.style.pointerEvents = "";

    animate(content, {
      opacity: [0, 1],
      translateY: ["1.25rem", "0rem"],
      scale: [0.985, 1],
      filter: ["blur(12px)", "blur(0px)"],
      duration: 620,
      ease: "outCubic",
    });
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

    const content = contentRef.current;

    if (!content) {
      router.push(anchor.pathname + anchor.search + anchor.hash);
      return;
    }

    isTransitioningRef.current = true;
    document.documentElement.classList.add("is-route-changing");
    content.style.pointerEvents = "none";

    animate(content, {
      opacity: 0,
      translateY: "-0.85rem",
      scale: 0.985,
      filter: "blur(10px)",
      duration: 280,
      ease: "inCubic",
    });

    window.setTimeout(() => {
      router.push(anchor.pathname + anchor.search + anchor.hash);
    }, 250);
  }

  return (
    <div className="page-transition-root" onClick={handleClick} ref={contentRef}>
      {children}
    </div>
  );
}
