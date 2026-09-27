import article from "../../../src/data/syncAsyncArticle.json";
import { EventDrivenArticle } from "../../../src/components/EventDrivenArticle.jsx";
import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";

export const metadata = {
  title: `${article.title} | Huang`,
  description: article.description,
  alternates: { canonical: "/articles/sync-async" },
};

export default function SyncAsyncPage() {
  return (
    <IllustratedPageFrame active="articles" showHero={false}>
      <EventDrivenArticle
        article={article}
        category="同步与异步"
        mapHref="/articles/knowledge-map#sync-async"
        sourceLabel="依据 MDN、Node.js 与 Linux 官方资料"
      />
    </IllustratedPageFrame>
  );
}
