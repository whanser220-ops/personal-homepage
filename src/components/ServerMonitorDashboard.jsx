"use client";

import Link from "next/link";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowRight, ArrowUp, Box, ChartNoAxesCombined, Check, ChevronRight, Cpu, Grid2X2, HardDrive, LoaderCircle, LockKeyhole, LogOut, MemoryStick, Moon, Network, RefreshCw, ShieldCheck, Sun, X } from "lucide-react";
import styles from "./ServerMonitorDashboard.module.css";

const css = (...names) => names.filter(Boolean).map((name) => styles[name]).join(" ");
const RANGES = [{ value: "1h", label: "1 小时", seconds: 3600 }, { value: "24h", label: "24 小时", seconds: 86400 }, { value: "7d", label: "7 天", seconds: 604800 }];
const RESOURCE_SERIES = [{ key: "cpuPercent", label: "CPU", color: "var(--cyan)" }, { key: "memoryPercent", label: "内存", color: "var(--lilac)" }, { key: "swapPercent", label: "Swap", color: "var(--mint)" }, { key: "diskPercent", label: "磁盘", color: "var(--peach)" }];
const NETWORK_SERIES = [{ key: "rxBytesPerSecond", label: "接收", color: "var(--cyan)" }, { key: "txBytesPerSecond", label: "发送", color: "var(--lilac)" }];
const DISK_SERIES = [{ key: "diskReadBytesPerSecond", label: "读取", color: "var(--mint)" }, { key: "diskWriteBytesPerSecond", label: "写入", color: "var(--lilac)" }];
const validNumber = (value) => typeof value === "number" && Number.isFinite(value);
const percentage = (value) => validNumber(value) ? `${value.toFixed(1)}%` : "—";
const plainNumber = (value, digits = 2) => validNumber(value) ? value.toFixed(digits) : "—";
function byteParts(value, digits = 1) {
  if (!validNumber(value) || value < 0) return { value: "—", unit: "" };
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = value === 0 ? 0 : Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return { value: (value / 1024 ** unit).toFixed(unit ? digits : 0), unit: units[unit] };
}
function bytes(value, digits = 1) { const result = byteParts(value, digits); return `${result.value}${result.unit ? ` ${result.unit}` : ""}`; }
function rate(value) { return validNumber(value) && value >= 0 ? `${bytes(value)}/s` : "—"; }
function dateLabel(value, withDate = true, withSeconds = withDate) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: withDate ? "2-digit" : undefined, day: withDate ? "2-digit" : undefined, hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined, hour12: false });
}
function uptime(seconds) { return !validNumber(seconds) ? "—" : `${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分钟`; }
function imageVersion(image) { if (!image) return "版本未知"; if (image.includes("@")) return image.split("@").at(-1); const last = image.split("/").at(-1); return last.includes(":") ? last.slice(last.lastIndexOf(":") + 1) : "未指定标签"; }
function containerState(value) { return ({ running: "运行中", exited: "已退出", restarting: "重启中", paused: "已暂停", created: "已创建", dead: "已停止" })[value] || "未知"; }
function containerHealth(value) { return ({ healthy: "健康", unhealthy: "不健康", starting: "启动检查中", none: "未配置" })[value] || "未配置 / 未知"; }
function serviceState(service) {
  if (service.status === "unhealthy") return { tone: "danger", label: "异常" };
  if (service.status !== "healthy" && service.status !== "reachable") return { tone: "neutral", label: "未知" };
  if (service.kind === "tcp") return { tone: "info", label: "端口可达" };
  if (service.kind === "process") return { tone: "success", label: "进程运行" };
  return service.status === "reachable" ? { tone: "info", label: "HTTP 可达" } : { tone: "success", label: "HTTP 健康" };
}
function checkKind(service) { return service.kind === "http" ? "HTTP 检查" : service.kind === "process" ? "进程 / 就绪检查" : "TCP 端口检查"; }
async function requestJson(url, signal, options = {}) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal, ...options });
  if (!response.ok) { const error = new Error(response.status === 401 ? "登录已过期，请重新登录。" : `请求失败（HTTP ${response.status}），稍后将自动重试。`); error.status = response.status; throw error; }
  return response.json();
}
function Background() {
  const id = useId().replace(/:/g, "");
  return <div className={styles.backdrop} aria-hidden="true"><svg className={styles["light-ribbons"]} viewBox="0 0 1600 1100" preserveAspectRatio="none"><defs><linearGradient id={`${id}-ribbon`} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#79edd2" stopOpacity=".04" /><stop offset=".44" stopColor="#6cdbc6" stopOpacity=".7" /><stop offset="1" stopColor="#7fddf9" stopOpacity=".13" /></linearGradient><linearGradient id={`${id}-shadow`}><stop stopColor="#1e7387" stopOpacity=".05" /><stop offset=".5" stopColor="#2e969b" stopOpacity=".4" /><stop offset="1" stopColor="#65cbb6" stopOpacity=".1" /></linearGradient></defs><path d="M-150 1090C240 600 440 1050 890 840S1240 350 1700 450" fill="none" stroke={`url(#${id}-shadow)`} strokeWidth="310" /><path d="M-100 1070C280 680 450 1040 900 810S1250 380 1660 440" fill="none" stroke={`url(#${id}-ribbon)`} strokeWidth="170" /><path d="M-100 1070C280 680 450 1040 900 810S1250 380 1660 440" fill="none" stroke="#b8ffe3" strokeOpacity=".27" strokeWidth="15" /></svg><div className={styles["ambient-spot"]} /></div>;
}
function Status({ tone = "neutral", children, className = "" }) { return <span className={`${css("status", tone)} ${className}`}><i className={styles["tiny-dot"]} aria-hidden="true" />{children}</span>; }
function Gauge({ title, icon: Icon, value, note, footer, extra, selected, onClick, metric }) {
  const circumference = Math.PI * 140;
  return <button id={`monitor-${metric}`} className={css("glass", "metric-card")} type="button" aria-pressed={selected} onClick={onClick} aria-label={`${title} ${percentage(value)}，聚焦历史曲线`}><span className={styles["card-top"]}><span className={styles["card-title"]}><Icon aria-hidden="true" />{title}</span><ChevronRight className={styles.chevron} aria-hidden="true" /></span><span className={styles.gauge}><svg viewBox="0 0 180 180" aria-hidden="true"><circle className={styles["gauge-track"]} cx="90" cy="90" r="70" /><circle className={styles["gauge-progress"]} cx="90" cy="90" r="70" style={{ strokeDashoffset: validNumber(value) ? circumference * (1 - Math.min(100, Math.max(0, value)) / 100) : circumference, opacity: validNumber(value) ? 1 : 0 }} /></svg><span className={styles["gauge-value"]}><span className={styles["gauge-number"]}><span>{plainNumber(value, 1)}</span>{validNumber(value) && <small>%</small>}</span><span className={styles["gauge-state"]}>{note}</span></span></span><span className={styles["metric-footer"]}>{footer}</span><span className={styles["metric-extra"]}>{extra}</span></button>;
}

const HistoryChart = memo(function HistoryChart({ title, series, points = [], intervalSeconds, range, endTime, percent = false, loading, error, focus, onFocus, onRange, primary = false }) {
  const plot = useRef(null); const [width, setWidth] = useState(480); const [hover, setHover] = useState(null); const id = useId().replace(/:/g, "");
  useEffect(() => {
    const element = plot.current, measure = () => setWidth(Math.max(100, Math.floor(element.getBoundingClientRect().width)));
    measure();
    if (!window.ResizeObserver) { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { setHover(null); }, [range]);
  const duration = RANGES.find((item) => item.value === range).seconds * 1000, end = Number.isFinite(endTime) ? endTime : Date.now(), start = end - duration;
  const height = primary ? 194 : 162, left = percent ? 36 : 53, right = width - 7, top = 13, bottom = height - 27;
  const visible = useMemo(() => points.map((point) => ({ ...point, time: Date.parse(point?.collectedAt) })).filter((point) => Number.isFinite(point.time) && point.time >= start && point.time <= end).sort((a, b) => a.time - b.time), [points, start, end]);
  const values = visible.flatMap((point) => series.map((item) => point[item.key]).filter(validNumber));
  const hasData = values.length > 0, ceiling = percent ? Math.max(100, ...values) : Math.max(1, ...values) * 1.12, maxGap = Math.max(15, intervalSeconds || 15) * 1600;
  const x = (time) => left + (time - start) / duration * (right - left), y = (value) => bottom - Math.max(0, value) / ceiling * (bottom - top);
  const paths = series.map((item) => {
    const segments = []; let segment = [], previous = null;
    for (const point of visible) {
      const value = point[item.key];
      if (!validNumber(value)) { if (segment.length) segments.push(segment); segment = []; previous = null; continue; }
      if (previous !== null && point.time - previous > maxGap) { segments.push(segment); segment = []; }
      segment.push({ x: x(point.time), y: y(value) }); previous = point.time;
    }
    if (segment.length) segments.push(segment);
    return { ...item, segments };
  });
  const hovered = hover !== null ? visible[Math.max(0, Math.min(visible.length - 1, hover))] : null;
  function pointerMove(event) {
    if (!visible.length) return;
    const rect = plot.current.getBoundingClientRect(), target = start + ((event.clientX - rect.left) / rect.width * width - left) / (right - left) * duration;
    let nearest = 0; for (let index = 1; index < visible.length; index++) if (Math.abs(visible[index].time - target) < Math.abs(visible[nearest].time - target)) nearest = index;
    setHover(nearest);
  }
  function keyDown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault(); if (event.key === "Escape") return setHover(null); if (!visible.length) return;
    setHover((previous) => event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, (previous ?? visible.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
  }
  const describe = hovered ? `${dateLabel(hovered.collectedAt)}。${series.map((item) => `${item.label} ${percent ? percentage(hovered[item.key]) : rate(hovered[item.key])}`).join("，")}` : "";
  return <section className={css("glass", primary ? "history-card" : "secondary-chart")} id={primary ? "monitor-history" : undefined} aria-label={`${title}，最近${RANGES.find((item) => item.value === range).label}`}>
    <div className={styles["card-top"]}><h2 className={styles["card-title"]}><ChartNoAxesCombined aria-hidden="true" />{title}</h2>{primary ? <div className={styles["range-control"]} role="group" aria-label="历史时间范围">{RANGES.map((item) => <button key={item.value} type="button" data-range={item.value} aria-pressed={range === item.value} onClick={() => onRange(item.value)}>{item.label}</button>)}</div> : <span className={styles["sub-label"]}>{RANGES.find((item) => item.value === range).label}</span>}</div>
    <div className={styles["chart-legend"]}>{series.map((item) => <button key={item.key} className={styles["legend-button"]} type="button" disabled={!onFocus} aria-pressed={onFocus ? focus === item.key : undefined} onClick={() => onFocus?.(item.key)}><i style={{ background: item.color }} />{item.label}</button>)}<span className={styles["chart-instruction"]}>{loading ? <LoaderCircle className={styles.spin} size={12} aria-label="正在更新" /> : "移入查看 · ← →"}</span></div>
    {error && <p className={styles["inline-error"]} role="status">{error}</p>}
    <div ref={plot} className={styles["chart-shell"]} tabIndex={hasData ? 0 : undefined} role="group" aria-label={`${title}。左右方向键查看采样点，缺失数据保留断点。`} onPointerMove={pointerMove} onPointerLeave={() => { if (document.activeElement !== plot.current) setHover(null); }} onFocus={() => { if (visible.length) setHover(visible.length - 1); }} onBlur={() => setHover(null)} onKeyDown={keyDown}>
      {hasData ? <><svg className={styles["history-svg"]} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><defs>{series.map((item) => <linearGradient key={item.key} id={`${id}-${item.key}`} x1="0" x2="0" y1="0" y2="1"><stop stopColor={item.color} stopOpacity=".12" /><stop offset="1" stopColor={item.color} stopOpacity="0" /></linearGradient>)}</defs>
        {[0, .5, 1].map((ratio) => <g key={ratio}><line x1={left} y1={y(ceiling * ratio)} x2={right} y2={y(ceiling * ratio)} className={styles["grid-line"]} /><text x={left - 8} y={y(ceiling * ratio) + 3} textAnchor="end">{percent ? `${Math.round(ceiling * ratio)}%` : bytes(ceiling * ratio, 0)}</text></g>)}
        {paths.map((item) => <g key={item.key} opacity={focus && focus !== item.key ? .22 : 1}>{item.segments.map((segment, index) => { const path = segment.map((point, position) => `${position ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "); return <g key={index}>{segment.length > 1 && <path d={`${path} L${segment.at(-1).x},${bottom} L${segment[0].x},${bottom} Z`} fill={`url(#${id}-${item.key})`} />}<path d={path} fill="none" stroke={item.color} strokeWidth={focus === item.key ? 2.3 : 1.7} strokeLinecap="round" strokeLinejoin="round" />{segment.length === 1 && <circle cx={segment[0].x} cy={segment[0].y} r="2.5" fill={item.color} />}</g>; })}</g>)}
        {hovered && <g><line x1={x(hovered.time)} y1={top} x2={x(hovered.time)} y2={bottom} className={styles["hover-guide"]} />{series.map((item) => validNumber(hovered[item.key]) && <circle key={item.key} cx={x(hovered.time)} cy={y(hovered[item.key])} r="3" fill={item.color} className={styles["hover-point"]} />)}</g>}
        {[0, .5, 1].map((ratio) => <text key={ratio} x={left + ratio * (right - left)} y={height - 5} textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"}>{dateLabel(start + duration * ratio, range === "7d", false)}</text>)}
      </svg>{hovered && <div className={css("chart-tooltip", "visible")} style={{ left: Math.max(4, Math.min(x(hovered.time) - 77, width - 158)) }} aria-hidden="true"><time>{dateLabel(hovered.collectedAt, true, false)}</time>{series.map((item) => <div className={styles["tooltip-row"]} key={item.key}><span className={styles.key}><i style={{ background: item.color }} />{item.label}</span><strong>{percent ? percentage(hovered[item.key]) : rate(hovered[item.key])}</strong></div>)}</div>}</> : <div className={styles["chart-empty"]}>{loading ? <><LoaderCircle className={styles.spin} size={18} />正在读取历史采样…</> : error ? "历史数据暂不可用" : "这个时间段还没有采样数据"}<small>缺失采样保留断点</small></div>}
      <span className={styles.sr} aria-live="polite">{describe}</span>
    </div><div className={styles["chart-foot"]}><span className={styles["latest-label"]}>按时间窗口聚合</span><span className={styles.interval}>{intervalSeconds ? `${intervalSeconds} 秒 / 点` : "—"} · 北京时间</span></div>
  </section>;
});

function NetworkBars({ points }) {
  const recent = points.slice(-37), ceiling = Math.max(1, ...recent.flatMap((point) => [point?.rxBytesPerSecond, point?.txBytesPerSecond]).filter(validNumber)), step = 240 / Math.max(1, recent.length);
  return <svg className={styles["network-bars"]} viewBox="0 0 240 58" preserveAspectRatio="none" role="img" aria-label="当前历史范围的网络接收和发送，缺失采样留空"><line x1="0" x2="240" y1="54" y2="54" className={styles["grid-line"]} />{recent.map((point, index) => <g key={point?.collectedAt || index}>{validNumber(point?.rxBytesPerSecond) && <rect x={index * step} y={54 - point.rxBytesPerSecond / ceiling * 47} width={Math.max(1, step * .56)} height={point.rxBytesPerSecond / ceiling * 47} rx="1.5" fill="var(--cyan)" opacity=".7" />}{validNumber(point?.txBytesPerSecond) && <rect x={index * step + step * .56} y={54 - point.txBytesPerSecond / ceiling * 47} width={Math.max(1, step * .27)} height={point.txBytesPerSecond / ceiling * 47} rx="1" fill="var(--lilac)" opacity=".6" />}</g>)}</svg>;
}
function DetailDialog({ detail, onClose }) {
  const ref = useRef(null);
  useEffect(() => { if (detail && !ref.current.open) ref.current.showModal(); else if (!detail && ref.current.open) ref.current.close(); }, [detail]);
  return <dialog ref={ref} className={styles["detail-dialog"]} aria-labelledby="monitor-dialog-title" aria-describedby="monitor-dialog-copy" onClose={onClose} onClick={(event) => { if (event.target !== event.currentTarget) return; const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.currentTarget.close(); }}><p className={styles["dialog-eyebrow"]}>{detail?.eyebrow}</p><div className={styles["dialog-heading"]}><h2 id="monitor-dialog-title">{detail?.title}</h2><form method="dialog"><button className={styles["icon-button"]} aria-label="关闭详情"><X aria-hidden="true" /></button></form></div>{detail && <><div className={styles["dialog-status"]}><Status tone={detail.tone}>{detail.status}</Status></div><p id="monitor-dialog-copy" className={styles["dialog-copy"]}>{detail.copy}</p><div className={styles["dialog-detail"]}>{detail.rows.map(([label, value]) => <div className={styles["detail-row"]} key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p className={styles["dialog-footnote"]}>{detail.footnote}</p></>}</dialog>;
}

export function ServerMonitorDashboard() {
  const [session, setSession] = useState(null), [sessionError, setSessionError] = useState(""), [sessionAttempt, setSessionAttempt] = useState(0);
  const [current, setCurrent] = useState(null), [currentLoaded, setCurrentLoaded] = useState(false), [history, setHistory] = useState(null);
  const [range, setRange] = useState("1h"), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false);
  const [currentError, setCurrentError] = useState(""), [historyError, setHistoryError] = useState(""), [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false), [now, setNow] = useState(0), [clockOffset, setClockOffset] = useState(0), [loginError, setLoginError] = useState("");
  const [scene, setScene] = useState("ocean"), [focus, setFocus] = useState(null), [detail, setDetail] = useState(null), [nav, setNav] = useState("monitor-overview");
  const epoch = useRef(0), pollAbort = useRef(null);
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) setLoginError(["access_denied", "forbidden"].includes(error) ? "这个 Google 账号没有监控访问权限，请使用指定的已验证邮箱登录。" : "Google 登录未完成，请重新登录。若持续失败，请检查登录配置。");
    try { if (localStorage.getItem("server-monitor-scene") === "morning") setScene("morning"); } catch {}
    const syncHash = () => { const hash = window.location.hash.slice(1); setNav(["monitor-overview", "monitor-history", "monitor-services", "monitor-containers"].includes(hash) ? hash : "monitor-overview"); };
    syncHash(); window.addEventListener("hashchange", syncHash); setNow(Date.now()); const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(interval); window.removeEventListener("hashchange", syncHash); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let stopped = false; const timeout = setTimeout(() => controller.abort(), 12000); setSessionError("");
    requestJson("/api/monitor/auth/session", controller.signal).then((value) => { if (!stopped) setSession(value); }).catch((error) => { if (!stopped) setSessionError(controller.signal.aborted ? "登录状态读取超时，请重试。" : error.message); }).finally(() => clearTimeout(timeout));
    return () => { stopped = true; clearTimeout(timeout); controller.abort(); };
  }, [sessionAttempt]);
  function clearPrivateState(message = "") {
    epoch.current++; pollAbort.current?.abort(); setSession((previous) => ({ authenticated: false, configured: previous?.configured }));
    setCurrent(null); setHistory(null); setCurrentLoaded(false); setDetail(null); setLoading(false); setCurrentError(""); setHistoryError(""); setLoginError(message);
  }
  useEffect(() => {
    if (!session?.authenticated) return;
    let stopped = false, busy = false, controller; const generation = ++epoch.current; setHistory(null);
    async function load() {
      if (busy || stopped) return; busy = true; controller = new AbortController(); pollAbort.current = controller; const timeout = setTimeout(() => controller.abort(), 12000); setLoading(true);
      const results = await Promise.allSettled([requestJson("/api/monitor/current", controller.signal).then((value) => ({ value, receivedAt: Date.now() })), requestJson(`/api/monitor/history?range=${range}`, controller.signal)]);
      clearTimeout(timeout); if (stopped || generation !== epoch.current) return;
      if (results.some((result) => result.status === "rejected" && result.reason.status === 401)) clearPrivateState("登录已过期，请重新登录。");
      else {
        const [latest, historical] = results;
        if (latest.status === "fulfilled") { setCurrent(latest.value.value); setCurrentError(""); setCurrentLoaded(true); const serverTime = Date.parse(latest.value.value.serverTime); if (Number.isFinite(serverTime)) setClockOffset(serverTime - latest.value.receivedAt); }
        else setCurrentError(latest.reason.name === "AbortError" ? "实时数据读取超时，稍后将自动重试。" : latest.reason.message);
        if (historical.status === "fulfilled") { setHistory(historical.value); setHistoryError(""); }
        else setHistoryError(historical.reason.name === "AbortError" ? "历史数据读取超时，稍后将自动重试。" : historical.reason.message);
        setLoading(false);
      }
      busy = false;
    }
    load(); const interval = setInterval(load, 15000);
    return () => { stopped = true; epoch.current++; clearInterval(interval); controller?.abort(); };
  }, [session?.authenticated, range, refresh]);
  async function logout() {
    setLoggingOut(true); setLogoutError(""); const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try { await requestJson("/api/monitor/auth/logout", controller.signal, { method: "POST" }); clearPrivateState(); } catch { setLogoutError("退出失败，请重试。"); }
    finally { clearTimeout(timeout); setLoggingOut(false); }
  }
  function toggleScene() { setScene((previous) => { const next = previous === "ocean" ? "morning" : "ocean"; try { localStorage.setItem("server-monitor-scene", next); } catch {} return next; }); }
  function toggleFocus(key) { setFocus((previous) => previous === key ? null : key); }
  const sample = current?.sample, host = sample?.host, collected = Date.parse(sample?.collectedAt);
  const age = Number.isFinite(collected) ? Math.max(0, (now + clockOffset - collected) / 1000) : null, stale = Boolean(sample && (current.stale || age === null || age > 45));
  const services = sample?.services || [], containers = sample?.containers || [], abnormal = services.filter((service) => service.status === "unhealthy").length, unknown = services.filter((service) => service.status === "unknown").length;
  const points = history?.points || [], lastBucket = Date.parse(points.at(-1)?.collectedAt), serverEnd = Date.parse(current?.serverTime);
  const historyEnd = Number.isFinite(serverEnd) ? Math.max(serverEnd, Number.isFinite(lastBucket) ? lastBucket : serverEnd) : undefined;
  const diskUsed = byteParts(host?.disk?.usedBytes), rx = byteParts(host?.network?.rxBytesPerSecond), diskTotal = host?.disk?.totalBytes;
  const usedWidth = validNumber(diskTotal) && diskTotal > 0 && validNumber(host?.disk?.usedBytes) ? Math.min(100, host.disk.usedBytes / diskTotal * 100) : 0;
  const freeWidth = validNumber(diskTotal) && diskTotal > 0 && validNumber(host?.disk?.availableBytes) ? Math.min(100 - usedWidth, host.disk.availableBytes / diskTotal * 100) : 0;
  const sharedChart = { points, intervalSeconds: history?.intervalSeconds, range, endTime: historyEnd, loading, error: historyError };
  function serviceDetail(service) {
    const state = serviceState(service);
    setDetail({ eyebrow: "服务检查", title: service.name, tone: state.tone, status: state.label, copy: service.detail || "暂时没有进一步检查说明。", rows: [["检查方式", checkKind(service)], ["HTTP 状态", validNumber(service.httpStatus) ? String(service.httpStatus) : "不适用于此项检查"], ["响应耗时", validNumber(service.latencyMs) ? `${Math.round(service.latencyMs)} ms` : "—"], ["采样时间", dateLabel(sample.collectedAt)], ["快照状态", stale ? "已过期" : "最近采样"]], footnote: service.kind === "tcp" ? "仅证明本机 TCP 端口可连接，未验证业务功能。" : service.kind === "process" ? "仅证明进程运行或数据库就绪，不能代替业务功能检查。" : "HTTP 3xx、401、403 仅说明端点可达；认证跳转不直接判为故障。所有结果均为服务器本机视角。" });
  }
  function containerDetail(container) {
    setDetail({ eyebrow: "容器详情", title: container.name, tone: container.state === "running" && container.health !== "unhealthy" ? "success" : container.state === "unknown" ? "neutral" : "warning", status: containerState(container.state), copy: `健康检查：${containerHealth(container.health)}。容器运行状态与应用健康分别观察。`, rows: [["运行镜像", container.image || "—"], ["CPU 使用率", percentage(container.cpuPercent)], ["内存使用", bytes(container.memoryBytes)], ["内存占比", percentage(container.memoryPercent)], ["报告内存上限", container.memoryLimitBytes > 0 ? bytes(container.memoryLimitBytes) : "—"], ["重启次数", container.restartCount ?? "—"], ["采样时间", dateLabel(sample.collectedAt)]], footnote: "容器 CPU 按单个核心计量，多核可以超过 100%；报告的内存上限不代表已预留内存。" });
  }

  return <div className={styles.page} data-scene={scene}><Background /><div className={styles.shell}>
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" aria-label="Huang 首页"><span className={styles["brand-mark"]}><svg width="25" height="25" viewBox="0 0 30 30" fill="none" aria-hidden="true"><ellipse cx="15" cy="15" rx="5" ry="11" transform="rotate(35 15 15)" stroke="currentColor" strokeWidth="1.3" /><ellipse cx="15" cy="15" rx="5" ry="11" transform="rotate(-35 15 15)" stroke="currentColor" strokeWidth="1.3" /><circle cx="15" cy="15" r="2.7" fill="currentColor" /></svg></span><span className={styles["brand-title"]}>Huang<span className={styles["brand-subtitle"]}>SERVER MONITOR</span></span></Link>
      {session?.authenticated && <nav className={styles.topnav} aria-label="监控导航">{[["monitor-overview", "概览"], ["monitor-history", "资源"], ["monitor-services", "服务"], ["monitor-containers", "容器"]].map(([id, label]) => <a key={id} href={`#${id}`} aria-current={nav === id ? "page" : undefined} onClick={() => setNav(id)}>{label}</a>)}</nav>}
      <div className={styles["top-actions"]}>{session?.authenticated && <span className={styles["top-label"]}>{session.email}</span>}<button type="button" className={styles["icon-button"]} onClick={toggleScene} aria-label={scene === "ocean" ? "切换为晨光外观" : "切换为深海外观"} title="切换监控外观">{scene === "ocean" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</button>{session?.authenticated && <><button type="button" className={styles["icon-button"]} disabled={loading} onClick={() => setRefresh((previous) => previous + 1)} aria-label="刷新监控数据"><RefreshCw className={loading ? styles.spin : ""} aria-hidden="true" /></button><button type="button" className={styles["icon-button"]} disabled={loggingOut} onClick={logout} aria-label={loggingOut ? "正在退出" : "退出监控"}>{loggingOut ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <LogOut aria-hidden="true" />}</button></>}</div>
    </header>
    <main id="monitor-overview"><section className={styles.hero} aria-labelledby="monitor-title"><div><div className={styles.eyebrow}><i className={styles["tiny-dot"]} />Cloud · Private space</div><h1 id="monitor-title">服务器，尽在眼前。</h1><p>{host ? `${host.hostname || sample.hostId} · ${uptime(host.uptimeSeconds)}` : "一个安静、私密的服务器观察窗口。"}</p></div><div className={styles["hero-status"]}>{session?.authenticated ? <><Status tone={!sample ? "neutral" : stale ? "warning" : "success"} className={styles.pill}>{!sample ? loading ? "读取采样中" : "等待采样" : stale ? "数据已过期" : "采样持续更新"}</Status><time>{sample ? dateLabel(sample.collectedAt, false, true) : "—"}</time></> : <span className={styles.pill}><LockKeyhole size={11} aria-hidden="true" />私有访问</span>}</div></section>
    {!session?.authenticated ? <section className={css("glass", "login-panel")} aria-labelledby="monitor-private-title"><div className={styles["login-copy"]}><ShieldCheck className={styles["private-icon"]} size={29} aria-hidden="true" /><p className={styles["login-eyebrow"]}>ONLY FOR THE OWNER</p><h2 id="monitor-private-title">一台服务器，<br />一个安静的观察窗口。</h2><p>资源趋势、应用检查与容器状态，集中在这里。监控数据仅在授权账号登录后可见。</p><div className={styles["login-facts"]}><span>15 秒采样</span><span>7 天历史</span><span>本机视角</span></div></div><div className={styles["login-action"]}><LockKeyhole size={25} aria-hidden="true" /><h3>{!session && !sessionError ? "正在确认访问权限" : "登录私有看板"}</h3><p>仅限已授权的 Google 账号。</p>{loginError && <p className={styles["inline-error"]} role="alert">{loginError}</p>}{sessionError ? <><p className={styles["inline-error"]} role="alert">{sessionError}</p><button className={styles["primary-button"]} onClick={() => setSessionAttempt((previous) => previous + 1)}><RefreshCw size={15} aria-hidden="true" />重试</button></> : !session ? <span className={styles["auth-loading"]}><LoaderCircle className={styles.spin} size={17} aria-hidden="true" />读取登录状态…</span> : session.configured ? <a href="/api/monitor/auth/google/start" className={styles["primary-button"]}>使用 Google 登录<ArrowRight size={16} aria-hidden="true" /></a> : <p className={styles["config-notice"]}>Google 登录尚未配置，当前无法访问监控数据。</p>}<small>身份验证通过后才会请求监控数据。</small></div></section> : <>
      {logoutError && <p className={styles["error-banner"]} role="alert">{logoutError}</p>}{currentError && <p className={styles["error-banner"]} role="alert">{currentError}{sample ? " 当前保留最近一次采样。" : ""}</p>}<div className={styles["sample-bar"]} role="status"><Status tone={!sample ? "neutral" : stale ? "warning" : "success"}>{!sample ? loading ? "正在读取采样" : "等待首条采样" : stale ? "数据已过期" : "采样持续更新"}</Status><span>{sample ? `最后采样 ${dateLabel(sample.collectedAt)}${age !== null ? ` · ${Math.floor(age)} 秒前` : ""}` : "每 15 秒采样一次；超过 45 秒无新数据会标记为过期。"}</span><small>北京时间 · 服务器本机</small></div>{stale && <p className={styles["stale-notice"]}>超过 45 秒没有新采样。以下为历史快照，不能代表服务器当前状态。</p>}
      <div className={styles.dashboard}>
        <Gauge title="CPU" icon={Cpu} metric="cpu" value={host?.cpu?.percent} note={validNumber(host?.cpu?.percent) ? "宿主机使用率" : "等待有效采样"} selected={focus === "cpuPercent"} onClick={() => toggleFocus("cpuPercent")} footer={<><span><strong>{host?.cpu?.cores ?? "—"}</strong> 核心</span><span className={styles["small-value"]}>负载 <strong>{plainNumber(host?.cpu?.load1)}</strong></span></>} extra={`1 / 5 / 15 分钟：${plainNumber(host?.cpu?.load1)} / ${plainNumber(host?.cpu?.load5)} / ${plainNumber(host?.cpu?.load15)}`} />
        <Gauge title="内存" icon={MemoryStick} metric="memory" value={host?.memory?.usedPercent} note={`${bytes(host?.memory?.usedBytes)} / ${bytes(host?.memory?.totalBytes)}`} selected={focus === "memoryPercent"} onClick={() => toggleFocus("memoryPercent")} footer={<><span>可用 <strong>{bytes(host?.memory?.availableBytes)}</strong></span><span className={styles["small-value"]}>Swap <strong>{host?.swap?.totalBytes === 0 ? "未启用" : percentage(host?.swap?.usedPercent)}</strong></span></>} extra={`Swap ${bytes(host?.swap?.usedBytes)} / ${bytes(host?.swap?.totalBytes)}`} />
        <HistoryChart {...sharedChart} primary percent series={RESOURCE_SERIES} title={focus ? `${RESOURCE_SERIES.find((item) => item.key === focus)?.label || "资源"} 趋势` : "资源趋势"} focus={focus} onFocus={toggleFocus} onRange={setRange} />
        <section className={css("glass", "disk-card")} aria-labelledby="monitor-disk-title"><div className={styles["card-top"]}><h2 id="monitor-disk-title" className={styles["card-title"]}><HardDrive aria-hidden="true" />磁盘空间</h2><span className={styles["sub-label"]}>{host?.disk?.mount || "—"}</span></div><div className={styles["disk-main"]}><strong>{diskUsed.value}</strong><span>{diskUsed.unit}{diskUsed.unit && " / "}{bytes(diskTotal)}</span></div><p className={styles["disk-caption"]}>已使用 {percentage(host?.disk?.usedPercent)}</p><div className={styles["storage-bar"]} role="img" aria-label={`磁盘已用 ${bytes(host?.disk?.usedBytes)}，可用 ${bytes(host?.disk?.availableBytes)}`}><span className={styles["storage-used"]} style={{ width: `${usedWidth}%` }} /><span className={styles["storage-available"]} style={{ width: `${freeWidth}%` }} /><span className={styles["storage-reserved"]} /></div><div className={styles["storage-legend"]}><span><i />已用 {bytes(host?.disk?.usedBytes)}</span><span><i />可用 {bytes(host?.disk?.availableBytes)}</span></div><div className={styles["io-row"]}><span>读 <b>{rate(host?.disk?.readBytesPerSecond)}</b></span><span>写 <b>{rate(host?.disk?.writeBytesPerSecond)}</b></span></div></section>
        <section className={css("glass", "network-card")} aria-labelledby="monitor-network-title"><div className={styles["card-top"]}><h2 className={styles["card-title"]} id="monitor-network-title"><Network aria-hidden="true" />网络流量</h2><span className={styles["sub-label"]}>{host?.network?.interface || "—"}</span></div><div className={styles["network-primary"]}><ArrowDown aria-label="接收" /><strong>{rx.value}</strong><span>{rx.unit ? `${rx.unit}/s` : ""}</span></div><div className={styles["network-secondary"]}><ArrowUp aria-label="发送" /><strong>{rate(host?.network?.txBytesPerSecond)}</strong><span>发送</span></div><NetworkBars points={points} /><div className={styles["network-caption"]}><span>当前历史范围</span><strong>{RANGES.find((item) => item.value === range).label}</strong></div></section>
        <section className={css("glass", "services-card")} id="monitor-services" aria-labelledby="monitor-services-title"><div className={styles["card-top"]}><h2 className={styles["card-title"]} id="monitor-services-title"><Grid2X2 aria-hidden="true" />应用与服务</h2><Status className={styles.pill} tone={abnormal ? "danger" : !services.length || unknown ? "neutral" : "success"}>{services.length ? `${services.length} 项 · ${abnormal} 异常${unknown ? ` · ${unknown} 未知` : ""}` : "等待检查"}</Status></div><div className={styles["service-grid"]}>{services.map((service) => { const status = serviceState(service); return <button type="button" className={styles["service-button"]} key={service.id} onClick={() => serviceDetail(service)} aria-label={`查看${service.name}详情，${status.label}`}><span className={css("service-indicator", status.tone)} /><span className={styles["service-name"]}>{service.name}</span><span className={styles["service-status"]}>{validNumber(service.httpStatus) ? `HTTP ${service.httpStatus}` : status.label}</span><ChevronRight aria-hidden="true" /></button>; })}</div>{!services.length && <p className={styles["empty-list"]}>{!currentLoaded && loading ? "正在读取检查结果…" : "暂无服务检查结果"}</p>}<p className={styles["scope-note"]}>服务器本机视角 · HTTP / 进程 / TCP 分别解释</p></section>
        <section className={css("glass", "containers-card")} id="monitor-containers" aria-labelledby="monitor-containers-title"><div className={styles["card-top"]}><h2 className={styles["card-title"]} id="monitor-containers-title"><Box aria-hidden="true" />容器</h2><span className={styles["sub-label"]}>{containers.filter((container) => container.state === "running").length} / {containers.length} 个运行中</span></div><div className={styles["table-scroll"]}><table className={styles["container-table"]}><caption className={styles.sr}>Docker 容器资源、健康状态、重启次数与运行镜像。点击名称查看详情。</caption><thead><tr><th scope="col">名称 / 运行版本</th><th scope="col">状态 / 健康</th><th scope="col">CPU</th><th scope="col">内存</th><th scope="col">重启</th><th scope="col"><span className={styles.sr}>详情</span></th></tr></thead><tbody>{containers.map((container) => <tr key={container.name}><td><button type="button" className={styles["container-name"]} onClick={() => containerDetail(container)} aria-label={`查看容器 ${container.name} 详情`}><span className={styles["container-icon"]}><Box aria-hidden="true" /></span><span className={styles["container-name-text"]}><span className={styles.name}>{container.name}</span><small title={container.image || undefined}>{imageVersion(container.image)}</small></span></button></td><td><Status tone={container.state === "running" ? "success" : ["exited", "dead"].includes(container.state) ? "danger" : "neutral"}>{containerState(container.state)}</Status><small className={container.health === "unhealthy" ? styles.danger : ""}>{containerHealth(container.health)}</small></td><td><span className={styles["table-number"]}>{percentage(container.cpuPercent)}</span>{validNumber(container.cpuPercent) && <div className={styles["cpu-mini"]} aria-hidden="true"><span style={{ width: `${Math.min(100, container.cpuPercent)}%` }} /></div>}</td><td className={styles["table-number"]}>{bytes(container.memoryBytes)}<small>{percentage(container.memoryPercent)}{container.memoryLimitBytes > 0 ? ` / 上限 ${bytes(container.memoryLimitBytes)}` : ""}</small></td><td>{container.restartCount ?? "—"}</td><td><button type="button" className={styles["container-info"]} onClick={() => containerDetail(container)} aria-label={`打开 ${container.name} 详情`}><ChevronRight aria-hidden="true" /></button></td></tr>)}</tbody></table>{!containers.length && <p className={styles["empty-list"]}>暂无容器采样</p>}</div></section>
        <section className={css("glass", "collector-card")} aria-labelledby="monitor-host-title"><div className={styles["collector-heading"]}><span className={styles["collector-orb"]}><Activity aria-hidden="true" /></span><div><h2 id="monitor-host-title">持续采样，安静守候。</h2><p>{sample?.hostId || "等待主机采样"}</p></div></div><div className={styles["collector-stats"]}><div className={styles["collector-stat"]}><span>主机已运行</span><strong>{validNumber(host?.uptimeSeconds) ? Math.floor(host.uptimeSeconds / 86400) : "—"}<small>天</small></strong><p>{validNumber(host?.uptimeSeconds) ? `${Math.floor(host.uptimeSeconds % 86400 / 3600)} 小时 ${Math.floor(host.uptimeSeconds % 3600 / 60)} 分钟` : "运行时间未知"}</p></div><div className={styles["collector-stat"]}><span>最近采样</span><strong>{age === null ? "—" : Math.floor(age)}<small>秒前</small></strong><p>{stale ? "数据已过期" : sample ? "来自最近一次采样" : "等待第一条数据"}</p></div></div><div className={styles["collector-divider"]} /><div className={styles["collector-bottom"]}><div><span>采样周期</span><strong>15 秒</strong></div><div><span>历史保留</span><strong>最近 7 天</strong></div></div><div className={css("queue-good", stale ? "warning" : !sample ? "neutral" : "success")}>{sample && !stale ? <Check aria-hidden="true" /> : <Activity aria-hidden="true" />}{stale ? "快照已过期，请留意采集状态" : sample ? "仅展示真实采样数据" : "暂无主机数据"}</div></section>
        <HistoryChart {...sharedChart} title="网络收发趋势" series={NETWORK_SERIES} /><HistoryChart {...sharedChart} title="磁盘读写趋势" series={DISK_SERIES} />
      </div>
    </>}
    </main><footer className={styles.footer}><span><ShieldCheck aria-hidden="true" />服务器本机视角，<strong>不等于公网独立可用性。</strong></span><span className={styles["preview-label"]}>PRIVATE MONITOR · 数据缺失保留断点</span></footer><DetailDialog detail={session?.authenticated ? detail : null} onClose={() => setDetail(null)} />
  </div></div>;
}
