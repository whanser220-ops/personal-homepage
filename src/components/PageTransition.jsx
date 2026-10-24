"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { animate } from "animejs";

function shouldHandleLink(event, anchor, allowCurrentPage = false) {
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

  if (!allowCurrentPage && url.pathname === current.pathname && url.search === current.search) {
    return false;
  }

  return true;
}

function getTransitionTargets(root) {
  const targets = [...root.children].filter((child) => !child.classList.contains("site-header"));
  return targets.length > 0 ? targets : root;
}

export function PageTransition({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const contentRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const pendingNavigationRef = useRef(null);
  const animationRef = useRef(null);

  const cancelTransition = useCallback(() => {
    if (pendingNavigationRef.current !== null) {
      window.clearTimeout(pendingNavigationRef.current);
      pendingNavigationRef.current = null;
    }
    animationRef.current?.cancel();
    animationRef.current = null;
    isTransitioningRef.current = false;
    document.documentElement.classList.remove("is-route-changing");

    const content = contentRef.current;
    if (!content) return;

    const targets = getTransitionTargets(content);
    for (const target of [content, ...(Array.isArray(targets) ? targets : [targets])]) {
      target.style.opacity = "";
      target.style.transform = "";
      target.style.filter = "";
      target.style.pointerEvents = "";
    }
  }, []);

  useEffect(() => {
    function handleHeaderClick(event) {
      const anchor = event.target.closest?.(".site-header a[href]");
      if (isTransitioningRef.current && anchor && shouldHandleLink(event, anchor, true)) {
        cancelTransition();
      }
    }

    document.addEventListener("click", handleHeaderClick, true);
    return () => {
      document.removeEventListener("click", handleHeaderClick, true);
      cancelTransition();
    };
  }, [cancelTransition]);

  useEffect(() => {
    cancelTransition();
    const content = contentRef.current;
    if (!content || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return cancelTransition;
    }

    animationRef.current = animate(getTransitionTargets(content), {
      opacity: [0, 1],
      translateY: ["1.25rem", "0rem"],
      scale: [0.985, 1],
      filter: ["blur(12px)", "blur(0px)"],
      duration: 620,
      ease: "outCubic",
    });
    return cancelTransition;
  }, [pathname, cancelTransition]);

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

    const targets = getTransitionTargets(content);

    for (const target of Array.isArray(targets) ? targets : [targets]) {
      target.style.pointerEvents = "none";
    }

    animationRef.current?.cancel();
    animationRef.current = animate(targets, {
      opacity: 0,
      translateY: "-0.85rem",
      scale: 0.985,
      filter: "blur(10px)",
      duration: 280,
      ease: "inCubic",
    });

    pendingNavigationRef.current = window.setTimeout(() => {
      pendingNavigationRef.current = null;
      router.push(anchor.pathname + anchor.search + anchor.hash);
    }, 250);
  }

  return (
    <div className="page-transition-root" onClick={handleClick} ref={contentRef}>
      {children}
    </div>
  );
}
