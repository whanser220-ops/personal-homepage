"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { articles } from "../data/homepage.js";
import styles from "./KnowledgeMap.module.css";

const eventAnchors = ["event-driven", "event", "event-dispatch", "callback", "external-trigger", "async-control-flow", "event-subscription", "command-message"];
const syncAsyncAnchors = ["sync-async", "synchrony", "asynchrony", "blocking", "nonblocking", "concurrency", "parallelism"];

if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = "/articles/knowledge-map/";
}

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((module) => module.Excalidraw),
  { ssr: false, loading: () => <div className={styles.loading}>正在载入可交互白板…</div> },
);

const sourceUrl = "/articles/knowledge-map/software-concept-map.excalidraw";
const previewUrl = "/articles/knowledge-map/software-concept-map.png";

export function KnowledgeMap() {
  const [scene, setScene] = useState(null);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(sourceUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`白板数据加载失败（${response.status}）`);
        return response.json();
      })
      .then((data) => {
        if (active) setScene({
          elements: data.elements,
          appState: data.appState,
          files: data.files || {},
          scrollToContent: true,
        });
      })
      .catch((cause) => { if (active) setError(cause.message || "白板数据加载失败"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!editor || !scene) return undefined;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const targetPrefix = eventAnchors.includes(hash) ? "s4_" : syncAsyncAnchors.includes(hash) ? "s5_" : "s6_";
    let attempts = 0;
    let timer;
    const fitMap = () => {
      const elements = editor.getSceneElements();
      if (elements.length >= scene.elements.length) {
        const articleSection = elements.filter((element) => element.id.startsWith(targetPrefix));
        editor.scrollToContent(articleSection.length ? articleSection : elements, {
          fitToViewport: true,
          viewportZoomFactor: 0.76,
          canvasOffsets: { top: 112 },
          animate: false,
        });
        return;
      }
      attempts += 1;
      if (attempts < 30) timer = window.setTimeout(fitMap, 100);
    };
    fitMap();
    return () => window.clearTimeout(timer);
  }, [editor, scene]);

  return (
    <section className={styles.mapShell} aria-label="可交互软件体系知识白板">
      <div className={styles.anchorAliases} aria-hidden="true">
        {[...eventAnchors, ...syncAsyncAnchors].map((id) => <span id={id} key={id} />)}
      </div>
      <header className={styles.mapHeader}>
        <div>
          <p className={styles.kicker}>SOFTWARE SYSTEM / EXCALIDRAW</p>
          <h1>软件知识白板</h1>
          <p>初始聚焦与并发文章对应的第 06 区。用滚轮缩放、按住空格拖动浏览；其他分区可继续缩放查看，选中图形可查看元素。</p>
        </div>
        <Link className={styles.backLink} href="/articles">← 返回文章</Link>
      </header>

      <nav className={styles.articleNav} aria-label="白板相关学习文章">
        <span>相关文章</span>
        {articles.filter((article) => article.href).map((article) => <Link href={article.href} key={article.href}>{article.title}</Link>)}
      </nav>

      <div className={styles.mapActions}>
        <a href={sourceUrl} download="software-concept-map.excalidraw">下载可编辑白板源文件</a>
        <a href={previewUrl} target="_blank" rel="noreferrer">打开静态总览</a>
      </div>

      <div className={styles.canvasFrame}>
        {error ? <div className={styles.loading} role="alert">{error}<br /><a href={previewUrl}>查看静态总览图</a></div> : null}
        {!error && !scene ? <div className={styles.loading} role="status">正在载入白板…</div> : null}
        {scene ? <Excalidraw
          initialData={scene}
          langCode="zh-CN"
          theme="light"
          viewModeEnabled={false}
          name="软件知识白板"
          excalidrawAPI={setEditor}
        /> : null}
      </div>

      <p className={styles.mapNote}>此页面中的编辑是当前浏览器会话内的临时操作。需要保存的修改请下载源文件后用 Excalidraw 编辑，再通过维护流程更新。</p>
      <figure className={styles.preview}>
        <figcaption>静态预览（也可在白板中继续缩放查看）</figcaption>
        <a href={previewUrl} target="_blank" rel="noreferrer"><img src={previewUrl} alt="软件知识白板总览静态预览" /></a>
      </figure>
    </section>
  );
}
