import article from "../../../src/data/eventDrivenFirstPrinciples.json";
import { EventDrivenArticle } from "../../../src/components/EventDrivenArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: `${article.title} | Huang`,
  description: article.description,
  alternates: { canonical: "/articles/event-driven-from-first-principles" },
};

export default function EventDrivenFirstPrinciplesPage() {
  return (
    <IllustratedPageFrame active="articles" showHero={false}>
      <EventDrivenArticle article={article} sourceLabel="依据官方资料与可运行示例" />
    </IllustratedPageFrame>
  );
}
