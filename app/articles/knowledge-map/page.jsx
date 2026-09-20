import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";
import { KnowledgeMap } from "../../../src/components/KnowledgeMap.jsx";

export const metadata = {
  title: "知识地图 | Huang",
  description: "Huang 技术学习文章中的概念、关系和解释入口。",
};

export default function KnowledgeMapPage() {
  return (
    <IllustratedPageFrame
      active="articles"
      description="从具体文章回到概念之间的关系。"
      eyebrow="ARTICLES / KNOWLEDGE MAP"
      showHero={false}
      title="知识地图"
    >
      <KnowledgeMap />
    </IllustratedPageFrame>
  );
}
