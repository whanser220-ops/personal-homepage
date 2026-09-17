import { MessageSystemArticle } from "../../../src/components/MessageSystemArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: "消息系统：Pi Agent 怎样把“发生了什么”传给模型和界面 | Huang",
  description: "从 AgentMessage、Message 到 message_update、steer 和 followUp，看懂 Pi Agent 的消息系统。",
};

export default function MessageSystemArticlePage() {
  return (
    <IllustratedPageFrame
      active="articles"
      description="技术笔记、项目复盘，以及把想法逐渐说清楚的过程。"
      eyebrow="ARTICLE / MESSAGE SYSTEM"
      showHero={false}
      title="消息系统"
    >
      <MessageSystemArticle />
    </IllustratedPageFrame>
  );
}
