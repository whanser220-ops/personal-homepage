import article from "../../../src/data/eventDrivenArchitectureVideo.json";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";
import { VideoTimelineArticle } from "../../../src/components/VideoTimelineArticle.jsx";

export const metadata = {
  title: `${article.title} | Huang`,
  description: article.lead,
};

export default function EventDrivenArchitectureVideoPage() {
  return (
    <IllustratedPageFrame active="articles" showHero={false}>
      <VideoTimelineArticle article={article} />
    </IllustratedPageFrame>
  );
}
