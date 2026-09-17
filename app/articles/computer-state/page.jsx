import { ComputerStateArticle } from "../../../src/components/ComputerStateArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "计算机中的状态：谁保存了“现在”，谁决定下一步？ | Huang",
  description: "从变量、进程和 HTTP 请求，到 Pi Agent 的会话、运行时、上下文与业务事实。",
};

export default function ComputerStateArticlePage() {
  return (
    <IllustratedPageFrame
      active="articles"
      description="技术笔记、项目复盘，以及把想法逐渐说清楚的过程。"
      eyebrow="ARTICLE / COMPUTER STATE"
      showHero={false}
      title="状态"
    >
      <ComputerStateArticle />
    </IllustratedPageFrame>
  );
}
