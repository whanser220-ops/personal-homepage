import { ArticlesPage } from "../../src/components/ArticlesPage.jsx";
import { PageFrame } from "../../src/components/PageFrame.jsx";

export const metadata = {
  title: "文章 | Huang",
  description: "Huang 的技术笔记、项目复盘和页面交互实验记录。",
};

export default function ArticlesRoutePage() {
  return (
    <PageFrame>
      <ArticlesPage />
    </PageFrame>
  );
}
