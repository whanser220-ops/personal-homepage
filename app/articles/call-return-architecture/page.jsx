import article from "../../../src/data/callReturnArchitecture.json";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";
import { VideoTimelineArticle } from "../../../src/components/VideoTimelineArticle.jsx";

export const metadata = {
  title: `${article.title} | Huang`,
  description: article.lead,
};

export default function CallReturnArchitecturePage() {
  return (
    <IllustratedPageFrame active="articles" showHero={false}>
      <VideoTimelineArticle article={article} />
    </IllustratedPageFrame>
  );
}
