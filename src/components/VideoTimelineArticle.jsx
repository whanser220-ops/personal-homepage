"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./ArticleReading.module.css";

function ChapterLinks({ chapters, activeId }) {
  return (
    <ul className={styles.tocList}>
      {chapters.map((chapter, index) => (
        <li key={chapter.id}>
          <a
            aria-current={activeId === chapter.id ? "location" : undefined}
            className={activeId === chapter.id ? styles.tocActive : undefined}
            href={`#${chapter.id}`}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {chapter.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function VideoTimelineArticle({ article }) {
  const [activeId, setActiveId] = useState(article.chapters[0].id);
  const assetBase = article.assetBase || "/articles/call-return-architecture/frames";
  const imageUrl = (frame) => `${assetBase}/${frame.replace(/\.png$/, ".webp")}`;

  useEffect(() => {
    const headings = article.chapters.map(({ id }) => document.getElementById(id)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveId(visible[0].target.id);
    }, { rootMargin: "-112px 0px -62% 0px", threshold: [0, 1] });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [article]);

  const toc = (
    <>
      <aside className={styles.toc} aria-label="文章目录">
        <p className={styles.tocLabel}>ON THIS PAGE</p>
        <ChapterLinks chapters={article.chapters} activeId={activeId} />
      </aside>
      <details className={styles.mobileToc}>
        <summary>本页目录</summary>
        <nav aria-label="本页目录"><ChapterLinks chapters={article.chapters} activeId={activeId} /></nav>
      </details>
    </>
  );

  return (
    <article className={styles.articleShell}>
      <Link className={styles.backLink} href="/articles">← 返回文章列表</Link>
      <header className={styles.articleHeader}>
        <p className={styles.kicker}>视频图文 · 软件体系结构</p>
        <h1>{article.title}</h1>
        <p className={styles.lead}>{article.lead}</p>
        <div className={styles.meta}>
          <time dateTime={article.publishedAt || "2026-09-23"}>{article.publishedAt || "2026-09-23"}</time>
          <span>视频 {article.duration}</span>
          <span>{article.captionType}</span>
        </div>
      </header>

      <div className={styles.mobileTocWrap}>{toc}</div>
      <div className={styles.articleLayout}>
        <div className={styles.articleBody}>
          {article.chapters.map((chapter) => (
            <section key={chapter.id} aria-labelledby={chapter.id}>
              <span className={styles.chapterTime}>{chapter.time}</span>
              <h2 id={chapter.id}>{chapter.title}</h2>
              {chapter.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {chapter.frame ? (
                <figure className={styles.diagram}>
                  <a
                    aria-label={`打开原视频画面：${chapter.frameTime}`}
                    href={imageUrl(chapter.frame)}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <img
                      alt={chapter.alt}
                      decoding="async"
                      height="900"
                      loading="lazy"
                      src={imageUrl(chapter.frame)}
                      width="1600"
                    />
                  </a>
                  <figcaption>{chapter.caption}</figcaption>
                </figure>
              ) : null}
            </section>
          ))}
          <div className={styles.sourceNotes}>
            <span>来源与整理说明</span>
            <a href={article.sourceUrl} rel="noopener noreferrer" target="_blank">原视频：{article.sourceTitle}</a>
            <p>本文按视频时间顺序整理，文字为转述；字幕来自 Bilibili 自动字幕，图片是原视频对应时刻的画面。</p>
          </div>
        </div>
        {toc}
      </div>
    </article>
  );
}
