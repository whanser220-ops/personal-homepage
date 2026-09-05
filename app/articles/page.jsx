import { ArticlesPage } from "../../src/components/ArticlesPage.jsx";
import { IllustratedPageFrame } from "../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "文章 | Huang",
  description: "Huang 的技术笔记、项目复盘和页面交互实验记录。",
};

export default function ArticlesRoutePage() {
  return (
    <IllustratedPageFrame
      active="articles"
      description="技术笔记、项目复盘，以及把想法逐渐说清楚的过程。"
      eyebrow="ARTICLES / 思考手稿"
      title="文章"
    >
      <ArticlesPage />
    </IllustratedPageFrame>
  );
}
