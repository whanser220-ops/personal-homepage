import { AnimatedCat } from "./AnimatedCat.jsx";
import { Badge } from "./ui/badge.jsx";

const articles = [
  {
    status: "计划中",
    title: "个人主页的前端结构",
    body: "记录从静态页、Vite、React、Next.js 到组件库接入的项目演进。",
  },
  {
    status: "计划中",
    title: "部署流水线笔记",
    body: "整理 GitHub PR、Jenkins 自动构建和 Nginx 静态托管的流程。",
  },
  {
    status: "计划中",
    title: "交互动画实验",
    body: "沉淀 Anime.js、组件状态和页面动效之间的协作方式。",
  },
];

export function ArticlesPage() {
  return (
    <main className="content-page article-page">
      <section className="content-hero">
        <div>
          <p className="eyebrow">Articles</p>
          <h1>文章</h1>
          <p>这里会逐步放技术笔记、项目复盘和页面交互实验记录。</p>
        </div>
        <AnimatedCat className="content-cat" tone="pink" />
      </section>
      <section className="section content-section">
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
