"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import java from "highlight.js/lib/languages/java";
import json from "highlight.js/lib/languages/json";

import defaultArticle from "../data/eventDrivenClickArticle.json";
import styles from "./ArticleReading.module.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("java", java);
hljs.registerLanguage("json", json);

function InlineMarkdown({ text }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return link[2].startsWith("/")
      ? <Link key={index} href={link[2]}>{link[1]}</Link>
      : <a key={index} href={link[2]} rel="noreferrer" target="_blank">{link[1]}</a>;
    return part;
  });
}

function CodeBlock({ language, source }) {
  const result = hljs.highlight(source, { language }).value;
  return <pre className={styles.codeBlock} data-language={language}><code dangerouslySetInnerHTML={{ __html: result }} /></pre>;
}

function MarkdownBlocks({ content, subsections = [] }) {
  const lines = content.split("\n");
  const blocks = [];
  let subsectionIndex = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }

    const subsection = line.match(/^###\s+(.+?)\s*$/);
    if (subsection) {
      const heading = subsections[subsectionIndex++];
      blocks.push(<h3 id={heading?.id} key={blocks.length}>{subsection[1]}</h3>);
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w+)\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) code.push(lines[index++]);
      index += 1;
      blocks.push(<CodeBlock key={blocks.length} language={fence[1]} source={code.join("\n")} />);
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      index += 1;
      while (index < lines.length && !lines[index].trim()) index += 1;
      const captionMatch = lines[index]?.trim().match(/^\*(.+)\*$/);
      const caption = captionMatch?.[1];
      if (captionMatch) index += 1;
      blocks.push(<figure className={styles.diagram} data-article-figure key={blocks.length}>
        <img alt={image[1]} src={image[2]} />
        <a className={styles.figureOpen} href={image[2]} rel="noreferrer" target="_blank">打开原尺寸图示查看细节 ↗</a>
        {image[2].includes("event-collaboration-candidate.svg") ? <a className={styles.mapLink} href="/articles/knowledge-map#event-driven">查看统一软件知识地图的事件区域</a> : null}
        {image[2].includes("architecture-position.png") ? <a className={styles.mapLink} download="software-atlas.excalidraw" href="/articles/knowledge-map/software-atlas.excalidraw">下载完整可编辑软件体系地图</a> : null}
        {caption ? <figcaption><InlineMarkdown text={caption} /></figcaption> : null}
      </figure>);
      continue;
    }

    if (line.startsWith("|")) {
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        const cells = lines[index++].trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push(cells);
      }
      blocks.push(<table key={blocks.length}><thead><tr>{rows[0].map((cell) => <th key={cell}><InlineMarkdown text={cell} /></th>)}</tr></thead><tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><InlineMarkdown text={cell} /></td>)}</tr>)}</tbody></table>);
      continue;
    }

    const listType = line.match(/^(?:-\s+|\d+\.\s+)/)?.[0];
    if (listType) {
      const ordered = /^\d/.test(listType);
      const items = [];
      while (index < lines.length && (ordered ? /^\d+\.\s+/.test(lines[index].trim()) : /^-\s+/.test(lines[index].trim()))) {
        items.push(lines[index++].trim().replace(ordered ? /^\d+\.\s+/ : /^-\s+/, ""));
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List className={styles.bulletList} key={blocks.length}>{items.map((item, itemIndex) => <li key={itemIndex}><InlineMarkdown text={item} /></li>)}</List>);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^```/.test(lines[index].trim()) && !/^\|/.test(lines[index].trim()) && !/^!\[/.test(lines[index].trim()) && !/^(?:-\s+|\d+\.\s+)/.test(lines[index].trim())) paragraph.push(lines[index++].trim());
    blocks.push(<p key={blocks.length}><InlineMarkdown text={paragraph.join(" ")} /></p>);
  }
  return blocks;
}

function ChapterLinks({ article, activeId }) {
  return <ul className={styles.tocList}>{article.toc.map((entry, index) => (
    <li key={entry.id}><a aria-current={activeId === entry.id ? "location" : undefined} className={`${activeId === entry.id ? styles.tocActive : ""} ${entry.level === 3 ? styles.tocSub : ""}`} href={`#${entry.id}`}>
      <span>{entry.level === 2 ? String(article.toc.slice(0, index + 1).filter((item) => item.level === 2).length).padStart(2, "0") : "↳"}</span>{entry.title}
    </a></li>
  ))}</ul>;
}

function ArticleToc({ article, activeId }) {
  return <>
    <aside className={styles.toc} aria-label="文章目录" data-article-toc><p className={styles.tocLabel}>ON THIS PAGE</p><ChapterLinks article={article} activeId={activeId} /></aside>
    <details className={styles.mobileToc} data-mobile-toc><summary>本页目录</summary><nav aria-label="本页目录"><ChapterLinks article={article} activeId={activeId} /></nav></details>
  </>;
}

export function EventDrivenArticle({ article = defaultArticle, sourceLabel = "依据原视频与官方资料", category = "事件驱动", mapHref = "/articles/knowledge-map" }) {
  const [activeId, setActiveId] = useState(article.toc[0].id);

  useEffect(() => {
    const headings = article.toc.map(({ id }) => document.getElementById(id)).filter(Boolean);
    const updateActiveHeading = () => {
      const current = headings.filter((heading) => heading.getBoundingClientRect().top <= 180).at(-1) || headings[0];
      if (current) setActiveId(current.id);
    };
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);
    updateActiveHeading();
    return () => {
      window.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [article]);

  return <article className={styles.articleShell} data-article-shell>
    <Link className={styles.backLink} href="/articles">← 返回文章列表</Link>
    <Link className={styles.mapLink} href={mapHref}>查看这篇文章在知识地图中的位置 →</Link>
    <header className={styles.articleHeader}>
      <p className={styles.kicker}>学习文章 · {category}</p>
      <h1>{article.title}</h1>
      <p className={styles.lead}>{article.lead}</p>
      <div className={styles.meta}><time dateTime={article.date}>{article.date}</time><span>{sourceLabel}</span></div>
    </header>
    <div className={styles.mobileTocWrap}><ArticleToc article={article} activeId={activeId} /></div>
    <div className={styles.articleLayout} data-article-layout>
      <div className={styles.articleBody} data-article-body>
        <MarkdownBlocks content={article.intro} />
        {article.chapters.map((chapter) => <section key={chapter.id} aria-labelledby={chapter.id}>
          <h2 id={chapter.id}>{chapter.title}</h2>
          <MarkdownBlocks content={chapter.content} subsections={chapter.subsections} />
        </section>)}
      </div>
      <ArticleToc article={article} activeId={activeId} />
    </div>
  </article>;
}
