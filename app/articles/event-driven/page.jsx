import { EventDrivenArticle } from "../../../src/components/EventDrivenArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "事件驱动：从 Pi Agent 的回调链路看懂“谁在什么时候调用谁” | Huang",
  description: "沿着 Pi Agent 的真实事件链路，理解事件产生、分发、回调，以及事件驱动与异步、事件循环的边界。",
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
