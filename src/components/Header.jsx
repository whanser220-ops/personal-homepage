"use client";

import { usePathname } from "next/navigation";
import { NavigationDock } from "./NavigationDock.jsx";

export function Header() {
  const pathname = usePathname();
  if (pathname === "/server-monitor" || pathname?.startsWith("/server-monitor/")) return null;

  return (
    <header className="site-header">
      <NavigationDock />
    </header>
  );
}
