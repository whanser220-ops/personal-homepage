import { AntdRegistry } from "@ant-design/nextjs-registry";
import "../src/styles.css";

export const metadata = {
  title: "Huang 的个人主页",
  description: "Huang 的个人主页，展示个人介绍、文章、项目作品和联系方式。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
