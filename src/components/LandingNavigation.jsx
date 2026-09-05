import Link from "next/link";
import { ArrowRight, BookOpen, FolderKanban } from "lucide-react";

import { articles, projects } from "../data/homepage.js";
import { IdentityCard, PortfolioNavigation } from "./IllustratedPageFrame.jsx";
import styles from "./LandingNavigation.module.css";

export function LandingNavigation() {
  const project = projects[0];

  return (
    <main className={styles.noteHomepage}>
      <img
        alt=""
        aria-hidden="true"
        className={styles.homepageWallImage}
        height="1271"
        src="/assets/hero-character-wall.png"
        width="1672"
      />
      <div aria-hidden="true" className={styles.homepageScrim} />

      <header className={styles.homeTopbar}>
        <IdentityCard />
        <PortfolioNavigation active="home" />
      </header>

      <div className={styles.homeLayout}>
        <section aria-labelledby="home-articles-title" className={styles.homeArticles}>
          <div className={styles.sectionHeading}>
            <BookOpen aria-hidden="true" size={24} />
            <h1 id="home-articles-title">文章</h1>
            <span>/ ARTICLES</span>
          </div>

          <div className={styles.articleCardList}>
            {articles.map((article, index) => (
              <Link className={styles.articleCard} href="/articles" key={article.title}>
                <span className={styles.articleNumber}>{String(index + 1).padStart(2, "0")}</span>
                <div className={styles.articleCardBody}>
                  <div className={styles.articleTitleRow}>
                    <h2>{article.title}</h2>
                    <time>{article.date}</time>
                  </div>
                  <p>{article.body}</p>
                  <div className={styles.articleCardFooter}>
                    <span className={styles.articleTags}>
                      {(article.tags || [article.status]).map((tag) => (
                        <em key={tag}>{tag}</em>
                      ))}
                    </span>
                    <strong>
                      阅读全文
                      <ArrowRight aria-hidden="true" size={18} />
                    </strong>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className={styles.heroFocus} aria-label="手持咖啡的黑帽人物插画">
          <p>
            <span>一杯咖啡</span>
            <span>一段思考</span>
            <span>一些持续生长的创造</span>
          </p>
        </div>

        <section aria-labelledby="home-projects-title" className={styles.homeProjects}>
          <div className={`${styles.sectionHeading} ${styles.projectHeading}`}>
            <FolderKanban aria-hidden="true" size={25} />
            <h1 id="home-projects-title">项目</h1>
            <span>/ PROJECTS</span>
          </div>

          {project ? (
            <Link className={styles.projectDossier} href={project.links[0].href}>
              <div className={styles.projectIllustration}>
                <img alt="Unity6 自动构建流水线的手绘拓扑" src={project.image} />
              </div>
              <div className={styles.projectContent}>
                <div className={styles.projectMeta}>
                  <span>01</span>
                  <em>{project.status}</em>
                </div>
                <h2>{project.title}</h2>
                <p>{project.summary}</p>
                <div className={styles.projectTags}>
                  {project.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <strong className={styles.projectCta}>
                  查看项目
                  <ArrowRight aria-hidden="true" size={19} />
                </strong>
              </div>
            </Link>
          ) : null}
        </section>
      </div>
    </main>
  );
}
