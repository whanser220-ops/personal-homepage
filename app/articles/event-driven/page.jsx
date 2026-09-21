import { EventDrivenArticle } from "../../../src/components/EventDrivenArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "订阅之后，回调为什么没有立即执行？从一次 Agent 输出看懂事件驱动 | Huang",
  description: "从 Pi 0.85.1 的 subscribe、emit、processEvents 和 message_update 链路，理解事件驱动、回调、异步控制流与事件循环的边界。",
};

export default function EventDrivenArticlePage() {
  return (
    <IllustratedPageFrame
      active="articles"
      description="技术笔记、项目复盘，以及把想法逐渐说清楚的过程。"
      eyebrow="ARTICLE / EVENT-DRIVEN"
      showHero={false}
      title="事件驱动"
    >
      <EventDrivenArticle />
    </IllustratedPageFrame>
  );
}
