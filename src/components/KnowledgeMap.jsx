"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { articles } from "../data/homepage.js";
import styles from "./KnowledgeMap.module.css";

const boards = [
  {
    id: "software-overview",
    label: "软件体系总览",
    title: "软件从开发到运行",
    description: "软件构成、交付、进程内运行和系统边界的总览白板。拖动画布并缩放查看区域。",
    svgUrl: "/articles/knowledge-map/software-concept-map.svg",
    sourceUrl: "/articles/knowledge-map/software-concept-map.excalidraw",
    sourceName: "software-concept-map.excalidraw",
  },
  {
    id: "event-collaboration",
    label: "事件协作局部图",
    title: "事件驱动在软件体系中的位置",
    description: "局部白板区分开发角色、进程内订阅与分发、跨服务通信，以及独立的运行调度视角。",
    svgUrl: "/articles/knowledge-map/event-collaboration-candidate.svg",
    sourceUrl: "/articles/knowledge-map/event-collaboration-candidate.excalidraw",
    sourceName: "event-collaboration-candidate.excalidraw",
  },
  {
    id: "sync-async",
    label: "同步/异步局部图",
    title: "同步与异步在软件体系中的位置",
    description: "从这块局部白板查看调用约定、宿主调度、线程和系统网络能力的边界。拖动或缩放查看细节。",
    svgUrl: "/articles/sync-async/assets/architecture-position.svg",
    sourceUrl: "/articles/knowledge-map/software-concept-map.excalidraw",
    sourceName: "software-concept-map.excalidraw",
  },
];

const eventAnchors = ["event-driven", "event", "event-dispatch", "callback", "external-trigger", "async-control-flow", "event-subscription", "command-message"];
const syncAsyncAnchors = ["sync-async", "synchrony", "asynchrony", "blocking", "nonblocking", "concurrency", "parallelism"];

function ExcalidrawBoard({ board }) {
  const hostRef = useRef(null);
  const dragRef = useRef(null);
  const [svg, setSvg] = useState("");
  const [viewBox, setViewBox] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setSvg("");
    setViewBox(null);
    setError("");
    fetch(board.svgUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`白板图像加载失败（HTTP ${response.status}）`);
        return response.text();
      })
      .then((markup) => {
        const dimensions = markup.match(/<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>/i)?.[1]?.split(/[ ,]+/).map(Number);
        if (!dimensions || dimensions.length !== 4 || dimensions.some((part) => !Number.isFinite(part))) throw new Error("白板 SVG 缺少有效的 viewBox");
        setViewBox({ x: dimensions[0], y: dimensions[1], width: dimensions[2], height: dimensions[3] });
        setSvg(markup);
      })
      .catch((cause) => {
        if (cause.name !== "AbortError") setError(cause.message);
      });
    return () => controller.abort();
  }, [board.svgUrl]);

  useEffect(() => {
    const svgElement = hostRef.current?.querySelector("svg");
    if (!svgElement || !viewBox) return;
    svgElement.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    svgElement.setAttribute("width", "100%");
    svgElement.setAttribute("height", "100%");
    svgElement.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svgElement.setAttribute("role", "img");
    svgElement.setAttribute("aria-label", board.title);
  }, [board.title, svg, viewBox]);

  const zoom = useCallback((factor) => {
    setViewBox((current) => {
      if (!current) return current;
      const width = current.width * factor;
      const height = current.height * factor;
      return { x: current.x + (current.width - width) / 2, y: current.y + (current.height - height) / 2, width, height };
    });
  }, []);

  const reset = useCallback(() => {
    const svgElement = hostRef.current?.querySelector("svg");
    const dimensions = svgElement?.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
    if (dimensions?.length === 4) setViewBox({ x: dimensions[0], y: dimensions[1], width: dimensions[2], height: dimensions[3] });
    else setViewBox(null);
    if (svg) {
      const match = svg.match(/<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>/i)?.[1]?.split(/[ ,]+/).map(Number);
      if (match?.length === 4) setViewBox({ x: match[0], y: match[1], width: match[2], height: match[3] });
    }
  }, [svg]);

  const beginPan = (event) => {
    if (event.button !== 0 || event.target.closest("button, a")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, rect, viewBox };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pan = (event) => {
    const drag = dragRef.current;
    if (!drag || !viewBox) return;
    const dx = (event.clientX - drag.clientX) / drag.rect.width * drag.viewBox.width;
    const dy = (event.clientY - drag.clientY) / drag.rect.height * drag.viewBox.height;
    setViewBox({ ...drag.viewBox, x: drag.viewBox.x - dx, y: drag.viewBox.y - dy });
  };

  return <section className={styles.boardPanel} aria-label={board.title}>
    <div className={styles.boardHeading} data-board-heading>
      <div><h2>{board.title}</h2><p>{board.description}</p></div>
      <a className={styles.sourceLink} href={board.sourceUrl} download={board.sourceName}>下载 Excalidraw 源文件</a>
    </div>
    <div className={styles.toolbar} aria-label="白板缩放控制">
      <button type="button" aria-label="放大白板" onClick={() => zoom(0.8)}>＋</button>
      <button type="button" aria-label="缩小白板" onClick={() => zoom(1.25)}>−</button>
      <button type="button" onClick={reset}>回到总览</button>
      <span>拖动画布 · 滚动缩放按钮</span>
    </div>
    <div
      className={styles.boardViewport}
      data-board-viewport
      onPointerDown={beginPan}
      onPointerMove={pan}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
      onWheel={(event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 0.92 : 1.09); }}
      role="region"
      aria-label={`${board.title}，可拖动和缩放的白板`}
    >
      {error ? <p className={styles.error}>{error}</p> : null}
      {!svg && !error ? <p className={styles.loading}>正在加载白板…</p> : null}
      <div ref={hostRef} className={styles.svgHost} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  </section>;
}

export function KnowledgeMap() {
  const [activeBoard, setActiveBoard] = useState("software-overview");
  const board = boards.find((item) => item.id === activeBoard) || boards[0];

  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (eventAnchors.includes(hash)) setActiveBoard("event-collaboration");
    if (syncAsyncAnchors.includes(hash)) setActiveBoard("sync-async");
  }, []);

  return <section className={styles.mapShell} aria-label="可编辑源文件支持的交互式软件体系白板">
    {eventAnchors.map((id) => <span className={styles.anchorAlias} id={id} key={id} />)}
    <header className={styles.mapHeader}>
      <div>
        <p className={styles.kicker}>ARTICLES / KNOWLEDGE MAP</p>
        <h1>软件体系白板</h1>
      <p>先看软件从开发到运行的整体位置，再切换到按主题整理的局部白板。所有白板均由可编辑的 Excalidraw 源文件导出；可缩放、平移，也可下载继续编辑。</p>
      </div>
      <Link className={styles.backLink} href="/articles">← 返回文章</Link>
    </header>

    <nav className={styles.boardTabs} aria-label="选择白板">
      {boards.map((item) => <button
        aria-current={activeBoard === item.id ? "page" : undefined}
        aria-pressed={activeBoard === item.id}
        className={activeBoard === item.id ? styles.activeTab : styles.tab}
        key={item.id}
        onClick={() => setActiveBoard(item.id)}
        type="button"
      >{item.label}</button>)}
    </nav>
    <ExcalidrawBoard board={board} key={board.id} />

    <section className={styles.articleNavigation} aria-labelledby="map-articles-heading">
      <div><p className={styles.kicker}>READING PATHS</p><h2 id="map-articles-heading">从文章进入具体问题</h2></div>
      <ul>{articles.filter((article) => article.href).map((article) => <li key={article.href}><Link href={article.href}>{article.title}<span aria-hidden="true">↗</span></Link></li>)}</ul>
    </section>
  </section>;
}
