import { ToolExecutionArticle } from "../../../src/components/ToolExecutionArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "工具系统：模型说“调用工具”后，代码究竟怎么执行 | Huang",
  description: "从 toolCall 开始，追踪 Agent Runtime 如何查找工具、校验参数、执行代码并回填结果。",
};

export default function ToolExecutionArticlePage() {
  return (
    <IllustratedPageFrame
      active="articles"
      description="技术笔记、项目复盘，以及把想法逐渐说清楚的过程。"
      eyebrow="ARTICLE / TOOL EXECUTION"
      showHero={false}
      title="工具系统"
    >
      <ToolExecutionArticle />
    </IllustratedPageFrame>
  );
}
