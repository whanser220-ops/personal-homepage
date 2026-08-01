import { Badge } from "./ui/badge.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.jsx";
import AnimatedContent from "./AnimatedContent.jsx";
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
          {articles.map((article, index) => (
            <AnimatedContent
              className="timeline-card-motion"
              delay={index * 0.06}
              distance={28}
              duration={0.58}
              key={article.title}
              threshold={0.16}
            >
              <Card asChild className="timeline-item">
                <article>
                  <CardHeader className="timeline-item-header">
                    <Badge variant="outline">{article.status}</Badge>
                    <CardTitle>{article.title}</CardTitle>
                    <CardDescription>{article.date}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p>{article.body}</p>
                  </CardContent>
                </article>
              </Card>
            </AnimatedContent>
          ))}
        </div>
      </section>
    </main>
  );
}
