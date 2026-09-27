import { EventDrivenArticle } from "../../../src/components/EventDrivenArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "事件驱动：从一次变化，到整个系统的反应 | Huang",
  description: "从一台设备温度越限后的连锁反应，看懂事件怎样产生、反应怎样组织，以及状态、命令、订阅、执行和结果为什么必须分开。",
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
