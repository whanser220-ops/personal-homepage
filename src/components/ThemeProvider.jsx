"use client";

import { useEffect } from "react";

const themePreferenceKey = "theme";
const darkQuery = "(prefers-color-scheme: dark)";

function getStoredTheme() {
  try {
    const value = window.localStorage.getItem(themePreferenceKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function getSystemTheme() {
  return window.matchMedia(darkQuery).matches ? "dark" : "light";
}

export function resolveTheme() {
  return getStoredTheme() ?? getSystemTheme();
}

export function applyTheme(theme) {
  const root = document.documentElement;
  const isDark = theme === "dark";

  root.classList.toggle("dark", isDark);
  root.style.colorScheme = theme;
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

export function setThemePreference(theme) {
  window.localStorage.setItem(themePreferenceKey, theme);
  applyTheme(theme);
}

export function ThemeProvider({ children }) {
  useEffect(() => {
    const media = window.matchMedia(darkQuery);

    const syncTheme = () => applyTheme(resolveTheme());
    const syncSystemTheme = () => {
      if (getStoredTheme() === null) {
        applyTheme(getSystemTheme());
      }
    };
    const syncStorageTheme = (event) => {
      if (event.key === themePreferenceKey) {
        syncTheme();
      }
    };

    syncTheme();
    media.addEventListener("change", syncSystemTheme);
    window.addEventListener("storage", syncStorageTheme);

    return () => {
      media.removeEventListener("change", syncSystemTheme);
      window.removeEventListener("storage", syncStorageTheme);
    };
  }, []);

  return children;
}
