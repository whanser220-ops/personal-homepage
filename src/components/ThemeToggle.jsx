"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { resolveTheme, setThemePreference } from "./ThemeProvider.jsx";

export function ThemeToggle({ className = "", onMouseEnter, spotIndex }) {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const syncTheme = () => setTheme(resolveTheme());

    syncTheme();
    window.addEventListener("themechange", syncTheme);

    return () => window.removeEventListener("themechange", syncTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);
    setThemePreference(nextTheme);
  };

  const Icon = theme === "dark" ? Sun : Moon;
  const label = theme === "dark" ? "切换浅色模式" : "切换深色模式";

  return (
    <button
      aria-label={label}
      className={className}
      data-dock-index={spotIndex}
      onClick={toggleTheme}
      onMouseEnter={onMouseEnter}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={25} strokeWidth={1.9} />
      <span>{label}</span>
    </button>
  );
}
