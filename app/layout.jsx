import { AntdRegistry } from "@ant-design/nextjs-registry";
import { PageTransition } from "../src/components/PageTransition.jsx";
import { ThemeProvider } from "../src/components/ThemeProvider.jsx";
import "../src/styles.css";

const themeInitScript = `
(() => {
  try {
    const storedTheme = window.localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : prefersDark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();
`;

export const metadata = {
  title: "Huang 的个人主页",
  description: "Huang 的个人主页，展示个人介绍、文章、项目作品和联系方式。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AntdRegistry>
            <PageTransition>{children}</PageTransition>
          </AntdRegistry>
        </ThemeProvider>
      </body>
    </html>
  );
}
