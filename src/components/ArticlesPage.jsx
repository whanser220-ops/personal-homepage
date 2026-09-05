import { BookOpen } from "lucide-react";

import { articles } from "../data/homepage.js";
import styles from "./LandingNavigation.module.css";

export function ArticlesPage() {
  return (
    <section aria-label="文章列表" className={styles.archiveSection}>
      <div className={styles.archiveSectionHeading}>
        <BookOpen aria-hidden="true" size={25} />
        <span>THOUGHTS ON PAPER</span>
      </div>

      <div className={styles.articleArchiveGrid}>
        {articles.map((article, index) => (
          <article className={styles.archiveArticleCard} key={article.title}>
            <div className={styles.archiveArticleTopline}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <time>{article.date}</time>
            </div>
            <h2>{article.title}</h2>
            <p>{article.body}</p>
            <div className={styles.archiveArticleFooter}>
              <span>
                {(article.tags || [article.status]).map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </span>
              <strong>{article.status}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
