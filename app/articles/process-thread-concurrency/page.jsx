import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";
import { ProcessThreadArticle } from "../../../src/components/ProcessThreadArticle.jsx";

export const metadata = {
  title: "多进程、多线程与并发：两张图片怎样一起处理 | Huang",
  description: "从批量生成缩略图出发，看懂进程与线程的边界、单核并发与多核并行，以及共享数据为什么需要同步。",
};

export default function ProcessThreadConcurrencyPage() {
  return (
    <IllustratedPageFrame
      active="articles"
      description="技术笔记、项目复盘，以及把想法逐渐说清楚的过程。"
      eyebrow="ARTICLE / PROCESS & THREADS"
      showHero={false}
      title="操作系统与并发"
    >
      <ProcessThreadArticle />
    </IllustratedPageFrame>
  );
}
