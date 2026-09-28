"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { articles } from "../data/homepage.js";
import styles from "./KnowledgeMap.module.css";

const boards = [
  {
    id: "software-overview",
    label: "软件体系总图",
    title: "软件体系总图",
    description: "以一个软件系统为中心，展开开发接口、代码角色、依赖、构建、运行、操作系统与产品实例七个区域。",
    source: "software-atlas.excalidraw",
    preview: "software-atlas.png",
  },
  {
    id: "event-collaboration",
    label: "事件协作",
    title: "事件驱动与事件协作",
    description: "查看事件生产、订阅与分发在进程内和跨服务时的责任边界，并回到总图对应区域。",
    source: "event-collaboration.excalidraw",
    preview: "event-collaboration.png",
  },
  {
    id: "sync-async",
    label: "同步与异步",
    title: "同步与异步",
    description: "从调用约定、宿主调度、线程与系统能力，定位同步和异步各自发生的边界。",
    source: "sync-async.excalidraw",
    preview: "sync-async.png",
  },
  {
    id: "process-thread",
    label: "进程与线程",
    title: "进程与线程",
    description: "查看单机进程资源、线程执行上下文、进程间通信、内核调度与 CPU 的关系。",
    source: "process-thread.excalidraw",
    preview: "process-thread.png",
  },
];

const mapBase = "/articles/knowledge-map/";
const hashBoard = new Map([
  ["software-overview", "software-overview"],
  ["event-driven", "event-collaboration"],
  ["event", "event-collaboration"],
  ["event-dispatch", "event-collaboration"],
  ["callback", "event-collaboration"],
  ["external-trigger", "event-collaboration"],
  ["async-control-flow", "event-collaboration"],
  ["event-subscription", "event-collaboration"],
  ["command-message", "event-collaboration"],
  ["sync-async", "sync-async"],
  ["synchrony", "sync-async"],
  ["asynchrony", "sync-async"],
  ["blocking", "sync-async"],
  ["nonblocking", "sync-async"],
  ["process-thread", "process-thread"],
  ["process", "process-thread"],
  ["thread", "process-thread"],
  ["concurrency", "process-thread"],
  ["parallelism", "process-thread"],
]);

const regionPrefix = {
  "software-overview": {
    "event-driven": "s4_",
    "event": "s4_",
    "event-dispatch": "s4_",
    "callback": "s4_",
    "external-trigger": "s4_",
    "async-control-flow": "s4_",
    "event-subscription": "s4_",
    "command-message": "s4_",
    "sync-async": "s5_",
    "synchrony": "s5_",
    "asynchrony": "s5_",
    "blocking": "s5_",
    "nonblocking": "s5_",
    "process-thread": "s6_",
    "process": "s6_",
    "thread": "s6_",
    "concurrency": "s6_",
    "parallelism": "s6_",
  },
};

if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = mapBase;
}

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((module) => module.Excalidraw),
  { ssr: false, loading: () => <div className={styles.loading}>正在载入可交互白板…</div> },
);

function boardForLocation() {
  const queryBoard = new URLSearchParams(window.location.search).get("board");
  const hash = hashBoard.get(decodeURIComponent(window.location.hash.slice(1)));
  if (hash) return hash;
  if (boards.some((board) => board.id === queryBoard)) return queryBoard;
  return "software-overview";
}

function scaleOverviewForNarrowScreen(elements, scale) {
  if (scale === 1) return elements;
  const scaleBinding = (binding) => binding
    ? { ...binding, ...(typeof binding.gap === "number" ? { gap: binding.gap * scale } : {}) }
    : binding;
  return elements.map((element) => ({
    ...element,
    x: element.x * scale,
    y: element.y * scale,
    width: element.width * scale,
    height: element.height * scale,
    ...(element.fontSize ? { fontSize: element.fontSize * scale } : {}),
    ...(element.baseline ? { baseline: element.baseline * scale } : {}),
    ...(element.strokeWidth ? { strokeWidth: element.strokeWidth * scale } : {}),
    ...(element.points ? { points: element.points.map(([x, y]) => [x * scale, y * scale]) } : {}),
    ...(element.startBinding ? { startBinding: scaleBinding(element.startBinding) } : {}),
    ...(element.endBinding ? { endBinding: scaleBinding(element.endBinding) } : {}),
  }));
}

export function KnowledgeMap() {
  const [activeId, setActiveId] = useState("software-overview");
  const [scene, setScene] = useState(null);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const frameRef = useRef(null);
  const editorRef = useRef(null);
  const panRef = useRef(null);
  const activeBoard = boards.find((board) => board.id === activeId) || boards[0];

  useEffect(() => {
    const syncLocation = () => setActiveId(boardForLocation());
    syncLocation();
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setScene(null);
    setError("");
    fetch(`${mapBase}${activeBoard.source}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`白板数据加载失败（${response.status}）`);
        return response.json();
      })
      .then((data) => {
        if (active) {
          const narrowOverview = activeBoard.id === "software-overview"
            && window.matchMedia("(max-width: 560px)").matches;
          setScene({
            elements: scaleOverviewForNarrowScreen(data.elements, narrowOverview ? 0.6 : 1),
            appState: data.appState,
            files: data.files || {},
            scrollToContent: true,
          });
        }
      })
      .catch((cause) => { if (active) setError(cause.message || "白板数据加载失败"); });
    return () => { active = false; };
  }, [activeBoard]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor || !scene) return undefined;
    let attempts = 0;
    let timer;
    const fitBoard = () => {
      const elements = editor.getSceneElements();
      if (elements.length >= scene.elements.length) {
        const hash = decodeURIComponent(window.location.hash.slice(1));
        const prefix = regionPrefix[activeId]?.[hash];
        const region = prefix ? elements.filter((element) => element.id.startsWith(prefix)) : [];
        editor.scrollToContent(region.length ? region : elements, {
          fitToViewport: true,
          viewportZoomFactor: 1,
          canvasOffsets: { top: 104 },
          animate: false,
        });
        return;
      }
      attempts += 1;
      if (attempts < 30) timer = window.setTimeout(fitBoard, 100);
    };
    fitBoard();
    return () => window.clearTimeout(timer);
  }, [activeId, editor, scene]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;

    const stopPan = (event) => {
      if (!panRef.current || event.pointerId !== panRef.current.pointerId) return;
      panRef.current = null;
      setIsPanning(false);
      frame.dataset.panning = "false";
      if (frame.hasPointerCapture?.(event.pointerId)) frame.releasePointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const onPointerDown = (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !event.target.closest?.(".excalidraw")) return;
      if (event.target.closest?.("button, a, input, textarea, select, [role=toolbar], [role=menu]")) return;
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      setIsPanning(true);
      frame.dataset.panning = "true";
      frame.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const onPointerMove = (event) => {
      const pan = panRef.current;
      const api = editorRef.current;
      if (!pan || event.pointerId !== pan.pointerId || !api) return;
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      pan.x = event.clientX;
      pan.y = event.clientY;
      const appState = api.getAppState();
      const zoom = appState.zoom?.value || 1;
      api.updateScene({ appState: { scrollX: appState.scrollX + dx / zoom, scrollY: appState.scrollY + dy / zoom } });
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const onWheel = (event) => {
      if (!event.target.closest?.(".excalidraw")) return;
      const api = editorRef.current;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (!api) return;
      const appState = api.getAppState();
      const oldZoom = appState.zoom?.value || 1;
      const multiplier = Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.0018);
      const nextZoom = Math.max(0.05, Math.min(4, oldZoom * multiplier));
      const bounds = frame.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const pointX = pointerX / oldZoom - appState.scrollX;
      const pointY = pointerY / oldZoom - appState.scrollY;
      api.updateScene({ appState: {
        zoom: { ...appState.zoom, value: nextZoom },
        scrollX: pointerX / nextZoom - pointX,
        scrollY: pointerY / nextZoom - pointY,
      } });
    };

    frame.addEventListener("pointerdown", onPointerDown, true);
    frame.addEventListener("pointermove", onPointerMove, true);
    frame.addEventListener("pointerup", stopPan, true);
    frame.addEventListener("pointercancel", stopPan, true);
    frame.addEventListener("lostpointercapture", stopPan, true);
    frame.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      frame.removeEventListener("pointerdown", onPointerDown, true);
      frame.removeEventListener("pointermove", onPointerMove, true);
      frame.removeEventListener("pointerup", stopPan, true);
      frame.removeEventListener("pointercancel", stopPan, true);
      frame.removeEventListener("lostpointercapture", stopPan, true);
      frame.removeEventListener("wheel", onWheel, true);
      panRef.current = null;
    };
  }, []);

  const selectBoard = useCallback((id, hash = id === "software-overview" ? "software-overview" : id) => {
    setActiveId(id);
    const suffix = hash ? `#${encodeURIComponent(hash)}` : "";
    const query = id === "software-overview" ? "" : `?board=${encodeURIComponent(id)}`;
    window.history.pushState(null, "", `/articles/knowledge-map${query}${suffix}`);
  }, []);

  const fitAll = useCallback(() => {
    const api = editorRef.current;
    if (!api) return;
    api.scrollToContent(api.getSceneElements(), {
      fitToViewport: true,
      viewportZoomFactor: 1,
      canvasOffsets: { top: 104 },
      animate: true,
    });
  }, []);

  const zoomBy = useCallback((factor) => {
    const api = editorRef.current;
    const frame = frameRef.current;
    if (!api || !frame) return;
    const appState = api.getAppState();
    const oldZoom = appState.zoom?.value || 1;
    const nextZoom = Math.max(0.1, Math.min(4, oldZoom * factor));
    const bounds = frame.getBoundingClientRect();
    const pointerX = bounds.width / 2;
    const pointerY = bounds.height / 2;
    const pointX = pointerX / oldZoom - appState.scrollX;
    const pointY = pointerY / oldZoom - appState.scrollY;
    api.updateScene({ appState: {
      zoom: { ...appState.zoom, value: nextZoom },
      scrollX: pointerX / nextZoom - pointX,
      scrollY: pointerY / nextZoom - pointY,
    } });
  }, []);

  return (
    <section className={styles.mapShell} aria-label="可交互软件体系知识白板">
      <header className={styles.mapHeader}>
        <div>
          <p className={styles.kicker}>SOFTWARE SYSTEM / EXCALIDRAW</p>
          <h1>软件知识白板</h1>
          <p>{activeBoard.description}滚轮以指针位置缩放；在白板上按住鼠标左键可平移，松开即停止。手机可用触控浏览和白板缩放控件。</p>
        </div>
        <Link className={styles.backLink} href="/articles">← 返回文章</Link>
      </header>

      <nav className={styles.boardNav} aria-label="选择知识地图">
        <span>关联白板</span>
        {boards.map((board) => (
          <button
            type="button"
            key={board.id}
            aria-pressed={activeId === board.id}
            onClick={() => selectBoard(board.id)}
          >
            {board.label}
          </button>
        ))}
      </nav>

      <nav className={styles.articleNav} aria-label="白板相关学习文章">
        <span>相关文章</span>
        {articles.filter((article) => article.href).map((article) => <Link href={article.href} key={article.href}>{article.title}</Link>)}
      </nav>

      <div className={styles.mapActions}>
        <button className={styles.focusButton} type="button" onClick={fitAll}>回到全图</button>
        <div className={styles.zoomControls} role="group" aria-label="白板缩放">
          <button className={styles.focusButton} type="button" aria-label="缩小白板" onClick={() => zoomBy(0.8)}>缩小</button>
          <button className={styles.focusButton} type="button" aria-label="放大白板" onClick={() => zoomBy(1.25)}>放大</button>
        </div>
        <a href={`${mapBase}${activeBoard.source}`} download={activeBoard.source}>下载当前白板源文件</a>
        <a href={`${mapBase}${activeBoard.preview}`} target="_blank" rel="noreferrer">打开当前静态预览</a>
      </div>

      <div ref={frameRef} className={styles.canvasFrame} data-panning={isPanning ? "true" : "false"}>
        {error ? <div className={styles.loading} role="alert">{error}<br /><a href={`${mapBase}${activeBoard.preview}`}>查看静态预览</a></div> : null}
        {!error && !scene ? <div className={styles.loading} role="status">正在载入白板…</div> : null}
        {scene ? <Excalidraw
          key={activeId}
          initialData={scene}
          langCode="zh-CN"
          theme="light"
          viewModeEnabled
          name={activeBoard.title}
          excalidrawAPI={setEditor}
        /> : null}
      </div>

      <p className={styles.mapNote}>白板用于浏览知识结构；页面中的操作只改变当前视图。需要编辑时请下载对应源文件，使用 Excalidraw 修改后再按维护流程更新。</p>
      <figure className={styles.preview}>
        <figcaption>{activeBoard.title}静态预览</figcaption>
        <a href={`${mapBase}${activeBoard.preview}`} target="_blank" rel="noreferrer"><img src={`${mapBase}${activeBoard.preview}`} alt={`${activeBoard.title}静态预览`} /></a>
      </figure>
    </section>
  );
}
