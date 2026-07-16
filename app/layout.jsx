import "../src/styles.css";

export const metadata = {
  title: "Huang 的个人主页",
  description: "Huang 的个人主页，展示个人介绍、能力方向、项目作品和联系方式。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
