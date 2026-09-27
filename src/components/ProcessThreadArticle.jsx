"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import java from "highlight.js/lib/languages/java";
import json from "highlight.js/lib/languages/json";
import csharp from "highlight.js/lib/languages/csharp";

import article from "../data/processThreadArticle.json";
import styles from "./ArticleReading.module.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("java", java);
hljs.registerLanguage("json", json);
hljs.registerLanguage("csharp", csharp);

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
      blocks.push(<figure className={styles.diagram} key={blocks.length}>
        <img alt={image[1]} src={image[2]} />
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

function ChapterLinks({ activeId }) {
  return <ul className={styles.tocList}>{article.toc.map((entry, index) => (
    <li key={entry.id}><a aria-current={activeId === entry.id ? "location" : undefined} className={`${activeId === entry.id ? styles.tocActive : ""} ${entry.level === 3 ? styles.tocSub : ""}`} href={`#${entry.id}`}>
      <span>{entry.level === 2 ? String(article.toc.slice(0, index + 1).filter((item) => item.level === 2).length).padStart(2, "0") : "↳"}</span>{entry.title}
    </a></li>
  ))}</ul>;
}

function ArticleToc({ activeId }) {
  return <>
    <aside className={styles.toc} aria-label="文章目录"><p className={styles.tocLabel}>ON THIS PAGE</p><ChapterLinks activeId={activeId} /></aside>
    <details className={styles.mobileToc}><summary>本页目录</summary><nav aria-label="本页目录"><ChapterLinks activeId={activeId} /></nav></details>
  </>;
}

export function ProcessThreadArticle() {
  const [activeId, setActiveId] = useState(article.toc[0].id);

  useEffect(() => {
    const headings = article.toc.map(({ id }) => document.getElementById(id)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveId(visible[0].target.id);
    }, { rootMargin: "-112px 0px -62% 0px", threshold: [0, 1] });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, []);

  return <article className={styles.articleShell}>
    <Link className={styles.backLink} href="/articles">← 返回文章列表</Link>
    <header className={styles.articleHeader}>
      <p className={styles.kicker}>学习文章 · 多进程、多线程与并发</p>
      <h1>{article.title}</h1>
      <p className={styles.lead}>{article.lead}</p>
      <div className={styles.meta}><time dateTime={article.date}>{article.date}</time><span>依据官方文档与教学示意</span></div>
    </header>
    <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>
    <div className={styles.articleLayout}>
      <div className={styles.articleBody}>
        <MarkdownBlocks content={article.intro} />
        {article.chapters.map((chapter) => <section key={chapter.id} aria-labelledby={chapter.id}>
          <h2 id={chapter.id}>{chapter.title}</h2>
          <MarkdownBlocks content={chapter.content} subsections={chapter.subsections} />
        </section>)}
      </div>
      <ArticleToc activeId={activeId} />
    </div>
  </article>;
}
