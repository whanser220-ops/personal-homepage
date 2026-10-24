"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const isHome = pathname === "/";
  const activeIndex = useMemo(() => getActiveIndex(pathname), [pathname]);
  const [spotIndex, setSpotIndex] = useState(activeIndex);
  const [homeExpanded, setHomeExpanded] = useState(false);
  const navRef = useRef(null);
  const headRef = useRef(null);
  const pointerDownRef = useRef(false);
  const hoveredRef = useRef(false);
  const keyboardFocusRef = useRef(false);
  const suppressFocusOpenRef = useRef(false);
  const themeSpotIndex = dockItems.length + 1;
  const expanded = !isHome || homeExpanded;

  const closeHome = useCallback(() => {
    keyboardFocusRef.current = false;
    const tail = navRef.current?.querySelector("[data-dock-tail]");
    if (tail?.contains(document.activeElement)) {
      suppressFocusOpenRef.current = true;
      headRef.current?.focus({ preventScroll: true });
      suppressFocusOpenRef.current = false;
    }
    setHomeExpanded(false);
    setSpotIndex(0);
  }, []);

  useEffect(() => {
    setSpotIndex(activeIndex);
    setHomeExpanded(false);
    hoveredRef.current = false;
    keyboardFocusRef.current = false;
    pointerDownRef.current = false;
  }, [pathname, activeIndex]);

  useEffect(() => {
    if (!isHome) return;
    function handleOutsidePointer(event) {
      if (!navRef.current?.contains(event.target)) {
        hoveredRef.current = false;
        closeHome();
      }
    }
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [isHome, closeHome]);

  useEffect(() => {
    if (!isHome || !expanded) return;
    function handleEscape(event) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closeHome();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isHome, expanded, closeHome]);

  return (
    <nav
      aria-label="主要导航"
      className={cn(css("navigation-dock"), className)}
      data-collapsible={isHome}
      data-expanded={expanded}
      ref={navRef}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        hoveredRef.current = true;
        if (isHome) setHomeExpanded(true);
      }}
      onPointerDown={() => {
        pointerDownRef.current = true;
        keyboardFocusRef.current = false;
      }}
      onPointerUp={() => { pointerDownRef.current = false; }}
      onPointerCancel={() => { pointerDownRef.current = false; }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        hoveredRef.current = false;
        const focusedItem = event.currentTarget.contains(document.activeElement)
          ? document.activeElement.closest("[data-dock-index]")
          : null;
        if (isHome && !(keyboardFocusRef.current && focusedItem)) {
          closeHome();
          return;
        }
        setSpotIndex(focusedItem ? Number(focusedItem.dataset.dockIndex) : activeIndex);
      }}
      onFocus={(event) => {
        const focusedItem = event.target.closest("[data-dock-index]");
        if (focusedItem) setSpotIndex(Number(focusedItem.dataset.dockIndex));
        if (!suppressFocusOpenRef.current && !pointerDownRef.current && event.target.matches(":focus-visible")) {
          keyboardFocusRef.current = true;
          if (isHome) setHomeExpanded(true);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          keyboardFocusRef.current = false;
          pointerDownRef.current = false;
          setSpotIndex(activeIndex);
          if (isHome && !hoveredRef.current) closeHome();
        }
      }}
      onKeyDown={(event) => {
        pointerDownRef.current = false;
        if (event.key === "Escape" && isHome && expanded) {
          event.preventDefault();
          event.stopPropagation();
          closeHome();
        }
      }}
      style={{
        "--dock-count": dockItems.length + 2,
        "--dock-spot-index": spotIndex ?? 0,
        "--dock-spot-opacity": spotIndex === null ? 0 : 1,
      }}
    >
      <span className={css("dock-spot")} aria-hidden="true" />
      {isHome ? (
        <button
          aria-label={expanded ? "收起导航" : "展开导航"}
          aria-expanded={expanded}
          aria-controls="primary-navigation-items"
          className={css("dock-avatar")}
          data-dock-index="0"
          onClick={() => {
            if (homeExpanded) closeHome();
            else setHomeExpanded(true);
          }}
          onMouseEnter={() => setSpotIndex(0)}
          ref={headRef}
          title={expanded ? "收起导航" : "展开导航"}
          type="button"
        >
          <img src="/assets/site-logo.png" alt="" width="54" height="54" />
        </button>
      ) : (
        <Link
          aria-label="首页"
          className={css("dock-avatar")}
          data-dock-index="0"
          href="/"
          onMouseEnter={() => setSpotIndex(0)}
          title="首页"
        >
          <img src="/assets/site-logo.png" alt="" width="54" height="54" />
        </Link>
      )}

      <div
        aria-hidden={!expanded ? true : undefined}
        className={css("dock-items")}
        data-dock-tail=""
        id="primary-navigation-items"
        inert={!expanded}
      >
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
              prefetch={isHome ? false : undefined}
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
      </div>
    </nav>
  );
}
