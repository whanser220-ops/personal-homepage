"use client";

import { useEffect, useState } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";

const defaultTokens = {
  isDark: false,
  primary: "#3f352e",
  accent: "#6d9284",
  success: "#6fb87e",
  warning: "#c9822b",
  destructive: "#b42318",
  foreground: "#3f352e",
  background: "#fff8f1",
  card: "#fffdf9",
  border: "#dfcec0",
  radius: 8,
};

function readThemeTokens() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const radiusValue = read("--radius", "0.5rem");
  const radiusNumber = Number.parseFloat(radiusValue);
  const radius = radiusValue.endsWith("px") ? radiusNumber : radiusNumber * 16;

  return {
    isDark: document.documentElement.classList.contains("dark"),
    primary: read("--primary", defaultTokens.primary),
    accent: read("--accent", defaultTokens.accent),
    success: read("--chart-2", defaultTokens.success),
    warning: read("--ring", defaultTokens.warning),
    destructive: read("--destructive", defaultTokens.destructive),
    foreground: read("--foreground", defaultTokens.foreground),
    background: read("--background", defaultTokens.background),
    card: read("--card", defaultTokens.card),
    border: read("--border", defaultTokens.border),
    radius: Number.isFinite(radius) ? radius : defaultTokens.radius,
  };
}

export function AntdProvider({ children }) {
  const [tokens, setTokens] = useState(defaultTokens);

  useEffect(() => {
    const syncTokens = () => setTokens(readThemeTokens());

    syncTokens();
    window.addEventListener("themechange", syncTokens);

    return () => window.removeEventListener("themechange", syncTokens);
  }, []);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: tokens.isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: tokens.accent,
          colorInfo: tokens.accent,
          colorSuccess: tokens.success,
          colorWarning: tokens.warning,
          colorError: tokens.destructive,
          colorText: tokens.foreground,
          colorBgBase: tokens.background,
          colorBgContainer: tokens.card,
          colorBorder: tokens.border,
          borderRadius: tokens.radius,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: {
            controlHeight: 36,
          },
          Card: {
            borderRadiusLG: tokens.radius,
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
