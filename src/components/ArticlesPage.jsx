import { Badge } from "./ui/badge.jsx";
import { articles } from "../data/homepage.js";

export function ArticlesPage() {
  return (
    <main className="content-page essay-page article-page">
      <header className="essay-hero page-animate">
        <p className="eyebrow">Articles</p>
        <h1>文章</h1>
        <p>这里会逐步放技术笔记、项目复盘和页面交互实验记录。</p>
      </header>
      <section className="section content-section page-animate">
        <div className="timeline" aria-label="文章列表">
          {articles.map((article) => (
            <article className="timeline-item" key={article.title}>
              <Badge>{article.status}</Badge>
              <h3>{article.title}</h3>
              <p>{article.body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
