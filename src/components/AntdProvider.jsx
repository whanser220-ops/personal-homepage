"use client";

import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

export function AntdProvider({ children }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#26858a",
          colorInfo: "#26858a",
          colorSuccess: "#6fb87e",
          colorWarning: "#c9822b",
          colorError: "#b42318",
          borderRadius: 8,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: {
            controlHeight: 36,
          },
          Card: {
            borderRadiusLG: 8,
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
