import { EventDrivenArticle } from "../../../src/components/EventDrivenArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "事件驱动：剧情发生变化后，该由谁安排接下来的反应？ | Huang",
  description: "从剧情 Agent 的‘发现纸条’场景出发，理解事件、订阅、分发、异步边界，以及它们如何映射回 Pi Agent。",
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
