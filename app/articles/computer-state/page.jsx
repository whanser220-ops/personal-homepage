import { ComputerStateArticle } from "../../../src/components/ComputerStateArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "计算机中的状态：同一个输入，为什么会得到不同结果？ | Huang",
  description: "从闸机、变量和状态转移，理解进程、HTTP 请求、游戏与 Agent 中的状态边界。",
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
