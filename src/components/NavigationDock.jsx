"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Smile, Star } from "lucide-react";

const dockItems = [
  { href: "/articles", label: "文章", icon: BookOpen },
  { href: "/about", label: "关于我", icon: Smile },
  { href: "/projects", label: "项目", icon: Star },
];

function getActiveIndex(pathname) {
  const itemIndex = dockItems.findIndex((item) => pathname === item.href);
  return itemIndex >= 0 ? itemIndex + 1 : 0;
}

export function NavigationDock({ className = "" }) {
  const pathname = usePathname();
  const activeIndex = useMemo(() => getActiveIndex(pathname), [pathname]);
  const [spotIndex, setSpotIndex] = useState(activeIndex);

  useEffect(() => {
    setSpotIndex(activeIndex);
  }, [activeIndex]);

  return (
    <nav
      aria-label="首页导航"
      className={`navigation-dock${className ? ` ${className}` : ""}`}
      onMouseLeave={() => setSpotIndex(activeIndex)}
      style={{ "--dock-spot-index": spotIndex }}
    >
      <span className="dock-spot" aria-hidden="true" />
      <Link
        aria-current={pathname === "/" ? "page" : undefined}
        aria-label="首页"
        className="dock-avatar"
        data-dock-index="0"
        href="/"
        onMouseEnter={() => setSpotIndex(0)}
        title="首页"
      >
        <img src="/assets/site-logo.webp" alt="" width="54" height="54" />
      </Link>

      {dockItems.map((item, index) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            aria-label={item.label}
            className={`dashboard-nav-link${isActive ? " is-active" : ""}`}
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
    </nav>
  );
}
