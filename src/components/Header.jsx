"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { animate, stagger } from "animejs";
import { BookOpen, FolderKanban, Smile } from "lucide-react";

const navItems = [
  { href: "/about", label: "关于我", icon: Smile },
  { href: "/articles", label: "文章", icon: BookOpen },
  { href: "/projects", label: "项目", icon: FolderKanban },
];

export function Header() {
  const pathname = usePathname();
  const headerRef = useRef(null);

  useEffect(() => {
    if (!headerRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    animate(headerRef.current, {
      opacity: { from: 0 },
      translateY: { from: "-0.75rem" },
      scale: { from: 0.96 },
      duration: 520,
      ease: "outCubic",
    });

    animate(headerRef.current.querySelectorAll(".site-nav-link"), {
      opacity: { from: 0 },
      translateY: { from: "0.45rem" },
      delay: stagger(55),
      duration: 420,
      ease: "outCubic",
    });
  }, [pathname]);

  return (
    <header className="site-header" ref={headerRef}>
      <nav className="site-nav-pill" aria-label="主导航">
        <Link className="site-nav-logo" href="/" aria-label="返回首页" title="返回首页">
          <img src="/assets/site-logo.webp" alt="" width="54" height="54" />
        </Link>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              aria-label={item.label}
              className={`site-nav-link${isActive ? " is-active" : ""}`}
              href={item.href}
              key={item.href}
              title={item.label}
            >
              <Icon aria-hidden="true" size={28} strokeWidth={1.9} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
