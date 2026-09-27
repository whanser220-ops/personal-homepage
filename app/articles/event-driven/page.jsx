import { EventDrivenArticle } from "../../../src/components/EventDrivenArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "事件驱动：点击保存之后，到底是谁调用了保存函数？ | Huang",
  description: "沿一个文档编辑器的保存操作，拆开事件的产生、注册、分发与执行，理解谁决定下一步，以及事件驱动为什么不等于异步。",
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
