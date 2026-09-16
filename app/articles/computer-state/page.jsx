import { ComputerStateArticle } from "../../../src/components/ComputerStateArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "状态：计算机如何记住“现在是什么” | Huang",
  description: "从进程、HTTP、会话和业务状态，到 Pi Agent 的消息历史、上下文与运行状态。",
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
