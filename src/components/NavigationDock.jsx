"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Smile, Star } from "lucide-react";
import { cn } from "../lib/utils.js";
import styles from "./NavigationDock.module.css";
import { ThemeToggle } from "./ThemeToggle.jsx";

const dockItems = [
  { href: "/articles", label: "文章", icon: BookOpen },
  { href: "/about", label: "关于我", icon: Smile },
  { href: "/projects", label: "项目", icon: Star },
];

function getActiveIndex(pathname) {
  const itemIndex = dockItems.findIndex((item) => pathname === item.href);
  return itemIndex >= 0 ? itemIndex + 1 : 0;
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
      aria-label="首页导航"
      className={cn(css("navigation-dock"), className)}
      onMouseLeave={() => setSpotIndex(activeIndex)}
      style={{ "--dock-spot-index": spotIndex }}
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
        const isActive = pathname === item.href;

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
