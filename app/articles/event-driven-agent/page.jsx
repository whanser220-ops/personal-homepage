import { EventDrivenAgentArticle } from "../../../src/components/EventDrivenAgentArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "事件驱动的 Agent：谁在什么时候把什么交给谁？",
  description: "从部署日志告警出发，解释事件对象、分发器、队列、Agent 循环与异步控制流的边界。",
};

export default function EventDrivenAgentPage() {
  return <IllustratedPageFrame active="articles" eyebrow="ARTICLES / EVENT-DRIVEN AGENT">
    <EventDrivenAgentArticle />
  </IllustratedPageFrame>;
}
