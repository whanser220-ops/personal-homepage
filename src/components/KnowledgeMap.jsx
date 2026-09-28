"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { articles } from "../data/homepage.js";
import styles from "./KnowledgeMap.module.css";

const mapBase = "/articles/knowledge-map/";
const minimumCanvasZoom = 0.1;
const legacyRegionAliases = {
  "software-overview": "all",
  "software-atlas": "all",
  "event-collaboration": "event-collaboration",
  event: "event-collaboration",
  "event-driven": "event-collaboration",
  "sync-async": "sync-async",
  synchrony: "sync-async",
  asynchrony: "sync-async",
  "process-thread": "process-thread",
  process: "process-thread",
  thread: "process-thread",
  concurrency: "process-thread",
  parallelism: "process-thread",
};

if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = mapBase;
}

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((module) => module.Excalidraw),
  { ssr: false, loading: () => <div className={styles.loading}>正在载入可交互白板…</div> },
);

function resolveRegionId(regions, value) {
  if (!value) return null;
  const normalized = legacyRegionAliases[value] || value;
  return regions.some((region) => region.id === normalized) ? normalized : null;
}

function regionForLocation(regions) {
  const regionList = Array.isArray(regions) ? regions : regions?.regions || [];
  const hash = decodeURIComponent(window.location.hash.slice(1));
  const hashRegion = regionList.find((region) => region.anchorIds?.includes(hash));
  if (hashRegion) return hashRegion.id;
  const hashId = resolveRegionId(regionList, hash);
  if (hashId) return hashId;
  const params = new URLSearchParams(window.location.search);
  return resolveRegionId(regionList, params.get("region") || params.get("board")) || "all";
}

function scaleAtlasElements(elements, scale) {
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

function scaleRegions(regions, scale) {
  if (scale === 1) return regions;
  return {
    ...regions,
    canvas: regions.canvas.map((value) => value * scale),
    regions: regions.regions.map((region) => ({
      ...region,
      bounds: region.bounds.map((value) => value * scale),
    })),
  };
}

function contentBounds(elements) {
  const visible = elements.filter((element) => !element.isDeleted);
  const left = Math.min(...visible.map((element) => element.x));
  const top = Math.min(...visible.map((element) => element.y));
  const right = Math.max(...visible.map((element) => element.x + element.width));
  const bottom = Math.max(...visible.map((element) => element.y + element.height));
  return [left, top, right - left, bottom - top];
}

export function KnowledgeMap() {
  const [regionData, setRegionData] = useState(null);
  const [activeId, setActiveId] = useState("all");
  const [scene, setScene] = useState(null);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const frameRef = useRef(null);
  const editorRef = useRef(null);
  const panRef = useRef(null);
  const activeRegion = regionData?.regions.find((region) => region.id === activeId) || regionData?.regions[0];

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`${mapBase}software-atlas.excalidraw`, { cache: "no-store" }),
      fetch(`${mapBase}regions.json`, { cache: "no-store" }),
    ])
      .then(async ([mapResponse, regionsResponse]) => {
        if (!mapResponse.ok) throw new Error(`白板数据加载失败（${mapResponse.status}）`);
        if (!regionsResponse.ok) throw new Error(`区域索引加载失败（${regionsResponse.status}）`);
        return Promise.all([mapResponse.json(), regionsResponse.json()]);
      })
      .then(([data, regions]) => {
        if (!active) return;
        const mobile = window.matchMedia("(max-width: 560px)").matches;
        const frameBounds = frameRef.current?.getBoundingClientRect();
        const canvasWidth = frameBounds?.width || window.innerWidth;
        const canvasHeight = frameBounds?.height || window.innerHeight;
        const widthScale = (canvasWidth - 24) / (regions.canvas[2] * minimumCanvasZoom);
        const heightScale = (canvasHeight - 24) / (regions.canvas[3] * minimumCanvasZoom);
        const scale = mobile ? Math.max(0.05, Math.min(1, widthScale, heightScale)) : 1;
        setRegionData(scaleRegions(regions, scale));
        setScene({
          elements: scaleAtlasElements(data.elements, scale),
          appState: data.appState,
          files: data.files || {},
          scrollToContent: false,
        });
        setActiveId(regionForLocation(regions));
      })
      .catch((cause) => { if (active) setError(cause.message || "白板数据加载失败"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!regionData) return undefined;
    const syncLocation = () => setActiveId(regionForLocation(regionData));
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
    };
  }, [regionData]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const focusRegion = useCallback((regionId) => {
    const api = editorRef.current;
    const frame = frameRef.current;
    const region = regionData?.regions.find((item) => item.id === regionId);
    if (!api || !frame || !region) return;
    const bounds = frame.getBoundingClientRect();
    const regionBounds = region.id === "all"
      ? contentBounds(api.getSceneElements())
      : region.bounds;
    const [x, y, width, height] = regionBounds;
    const availableWidth = Math.max(1, bounds.width - 48);
    const availableHeight = Math.max(1, bounds.height - 48);
    const fitZoom = Math.min(availableWidth / width, availableHeight / height) * 0.88;
    const zoom = Math.max(minimumCanvasZoom, Math.min(4, fitZoom));
    const appState = api.getAppState();
    api.updateScene({ appState: {
      zoom: { ...appState.zoom, value: zoom },
      scrollX: bounds.width / (2 * zoom) - (x + width / 2),
      scrollY: bounds.height / (2 * zoom) - (y + height / 2),
    } });
  }, [regionData]);

  useEffect(() => {
    if (!editor || !scene || !activeRegion) return undefined;
    let attempts = 0;
    let timer;
    const fitRegion = () => {
      const elements = editor.getSceneElements();
      if (elements.length >= scene.elements.length) {
        focusRegion(activeRegion.id);
        return;
      }
      attempts += 1;
      if (attempts < 40) timer = window.setTimeout(fitRegion, 100);
    };
    fitRegion();
    return () => window.clearTimeout(timer);
  }, [activeRegion, editor, focusRegion, scene]);

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
      const nextZoom = Math.max(0.1, Math.min(4, oldZoom * multiplier));
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

  const selectRegion = useCallback((regionId) => {
    const region = regionData?.regions.find((item) => item.id === regionId);
    if (!region) return;
    setActiveId(regionId);
    const search = regionId === "all" ? "" : `?region=${encodeURIComponent(regionId)}`;
    const hash = region.anchorIds?.[0] || regionId;
    window.history.pushState(null, "", `/articles/knowledge-map${search}#${encodeURIComponent(hash)}`);
    focusRegion(regionId);
  }, [focusRegion, regionData]);

  const fitAll = useCallback(() => selectRegion("all"), [selectRegion]);

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
          <p>所有软件主题都在同一张可编辑总图中。选择区域定位到对应内容；滚轮以指针位置缩放，按住鼠标左键可平移，松开即停止。手机可用触控浏览和缩放控件。</p>
        </div>
        <Link className={styles.backLink} href="/articles">← 返回文章</Link>
      </header>

      <nav className={styles.regionNav} aria-label="定位软件体系区域">
        <span>地图区域</span>
        {regionData?.regions.map((region) => (
          <button
            type="button"
            key={region.id}
            aria-pressed={activeId === region.id}
            onClick={() => selectRegion(region.id)}
          >
            {region.label}
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
        <a href={`${mapBase}software-atlas.excalidraw`} download="software-atlas.excalidraw">下载完整白板源文件</a>
        <a href={`${mapBase}software-atlas.png`} target="_blank" rel="noreferrer">打开静态总览预览</a>
      </div>

      <div ref={frameRef} className={styles.canvasFrame} data-panning={isPanning ? "true" : "false"}>
        {error ? <div className={styles.loading} role="alert">{error}<br /><a href={`${mapBase}software-atlas.png`}>查看静态预览</a></div> : null}
        {!error && !scene ? <div className={styles.loading} role="status">正在载入白板…</div> : null}
        {scene ? <Excalidraw
          initialData={scene}
          langCode="zh-CN"
          theme="light"
          viewModeEnabled
          name="软件体系总图"
          excalidrawAPI={setEditor}
        /> : null}
      </div>

      <p className={styles.mapNote}>白板操作只改变当前视图。需要编辑时请下载完整源文件，使用 Excalidraw 修改后再按维护流程更新。</p>
      <figure className={styles.preview}>
        <figcaption>软件体系总图静态预览</figcaption>
        <a href={`${mapBase}software-atlas.png`} target="_blank" rel="noreferrer"><img src={`${mapBase}software-atlas.png`} alt="软件体系总图静态预览" /></a>
      </figure>
    </section>
  );
}
