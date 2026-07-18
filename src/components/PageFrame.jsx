"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { animate, stagger } from "animejs";

import { Footer } from "./Footer.jsx";
import { Header } from "./Header.jsx";

export function PageFrame({ children }) {
  const pathname = usePathname();
  const contentRef = useRef(null);

  useEffect(() => {
    if (!contentRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    animate(contentRef.current, {
      opacity: { from: 0 },
      translateY: { from: "1rem" },
      duration: 520,
      ease: "outCubic",
    });

    animate(contentRef.current.querySelectorAll(".page-animate"), {
      opacity: { from: 0 },
      translateY: { from: "1.2rem" },
      delay: stagger(80),
      duration: 560,
      ease: "outCubic",
    });
  }, [pathname]);

  return (
    <>
      <Header />
      <div ref={contentRef}>{children}</div>
      <Footer />
    </>
  );
}
