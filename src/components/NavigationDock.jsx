"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, Smile, Star } from "lucide-react";
import { cn } from "../lib/utils.js";
import styles from "./NavigationDock.module.css";
import { ThemeToggle } from "./ThemeToggle.jsx";

const dockItems = [
  { href: "/articles", label: "文章", icon: BookOpen },
  { href: "/about", label: "关于我", icon: Smile },
  { href: "/projects", label: "项目", icon: Star },
  { href: "/server-monitor", label: "服务监控", icon: Activity },
];

function getActiveIndex(pathname) {
  if (pathname === "/") return 0;

  const itemIndex = dockItems.findIndex(
    (item) => pathname === item.href || pathname?.startsWith(`${item.href}/`),
  );
  return itemIndex >= 0 ? itemIndex + 1 : null;
}

function css(...names) {
  return cn(...names.map((name) => name && styles[name]));
}

export function NavigationDock({ className = "" }) {
  const pathname = usePathname();
  const activeIndex = useMemo(() => getActiveIndex(pathname), [pathname]);
  const [spotIndex, setSpotIndex] = useState(activeIndex);
  const themeSpotIndex = dockItems.length + 1;

  useEffect(() => {
    setSpotIndex(activeIndex);
  }, [activeIndex]);

  return (
    <nav
      aria-label="主要导航"
      className={cn(css("navigation-dock"), className)}
      onMouseLeave={(event) => {
        const focusedItem = event.currentTarget.contains(document.activeElement)
          ? document.activeElement.closest("[data-dock-index]")
          : null;
        setSpotIndex(focusedItem ? Number(focusedItem.dataset.dockIndex) : activeIndex);
      }}
      onFocus={(event) => {
        const focusedItem = event.target.closest("[data-dock-index]");
        if (focusedItem) setSpotIndex(Number(focusedItem.dataset.dockIndex));
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setSpotIndex(activeIndex);
      }}
      style={{
        "--dock-spot-index": spotIndex ?? 0,
        "--dock-spot-opacity": spotIndex === null ? 0 : 1,
      }}
    >
      <span className={css("dock-spot")} aria-hidden="true" />
      <Link
        aria-current={pathname === "/" ? "page" : undefined}
        aria-label="首页"
        className={css("dock-avatar")}
        data-dock-index="0"
        href="/"
        onMouseEnter={() => setSpotIndex(0)}
        title="首页"
      >
        <img src="/assets/site-logo.png" alt="" width="54" height="54" />
      </Link>

      {dockItems.map((item, index) => {
        const Icon = item.icon;
        const isActive = activeIndex === index + 1;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            aria-label={item.label}
            className={css("dashboard-nav-link", isActive && "is-active")}
            data-dock-index={index + 1}
            href={item.href}
            key={item.label}
            onMouseEnter={() => setSpotIndex(index + 1)}
            title={item.label}
          >
            <Icon aria-hidden="true" size={28} strokeWidth={1.9} />
            <span>{item.label}</span>
          </Link>
        );
      })}

      <ThemeToggle
        className={css("dashboard-nav-link")}
        onMouseEnter={() => setSpotIndex(themeSpotIndex)}
        spotIndex={themeSpotIndex}
      />
    </nav>
  );
}
