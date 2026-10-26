"use client";

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { chartGeometry, finite, historyResolution, monitorTime, numberLabel } from "./monitorView.js";
import styles from "./ServerMonitorDashboard.module.css";

// Adapted from Lieflat Charts F2/F3/F5/F11, pinned ed436ba56b3cbeee20b9b9966b38a9a9689e239c.
// PolyForm Noncommercial 1.0.0: https://polyformproject.org/licenses/noncommercial/1.0.0/
const INK = "#1C1C1A", PAPER = "#F0EFEB", GRID = "#DEDDD6", LADDER = [INK, "#6A6963", "#8F8E88", "#B0AFA9"];
const rnd = (i, k) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;
const polar = (cx, cy, radius, degree) => [cx + radius * Math.cos(degree * Math.PI / 180), cy + radius * Math.sin(degree * Math.PI / 180)];

export function CpuGauge({ value, stale }) {
  const known = finite(value), bounded = known ? Math.max(0, Math.min(100, value)) : 0;
  const [tipX, tipY] = polar(200, 185, 124, -195 + bounded / 100 * 210);
  return <svg viewBox="0 0 400 285" role="img" aria-label={`CPU 使用率 ${known ? `${numberLabel(value)}%` : "暂无样本"}${stale ? "，数据已过期" : ""}`} className={styles.gauge}>
    {Array.from({ length: 100 }, (_, k) => {
      const inked = known && k < Math.floor(bounded), angle = -195 + k / 100 * 210, length = inked ? 13 + rnd(k + 1, 3) * 6 : 5 + rnd(k + 1, 7) * 2.5;
      const [x1, y1] = polar(200, 185, 104, angle), [x2, y2] = polar(200, 185, 104 + length, angle);
      return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={inked ? INK : "#C6C5BF"} strokeWidth={inked ? 1 : .6} />;
    })}
    {[0, 25, 50, 75, 100].map((mark) => { const angle = -195 + mark / 100 * 210, [dx, dy] = polar(200, 185, 97, angle), [tx, ty] = polar(200, 185, 85, angle); return <g key={mark}><circle cx={dx} cy={dy} r={1} fill="#B0AFA9" /><text x={tx} y={ty + 3} textAnchor="middle" fontSize={9} fontWeight={600} fill="#6A6963">{mark}</text></g>; })}
    {known && <circle cx={tipX} cy={tipY} r={2.4} fill={INK} />}
    <text x={200} y={178} textAnchor="middle" fontSize={43} fontWeight={800} fill={INK}>{known ? numberLabel(value) : "—"}<tspan fontSize={17}>{known ? "%" : ""}</tspan></text>
    <text x={200} y={204} textAnchor="middle" fontSize={11} fontWeight={600} fill="#6A6963">{!known ? "等待采样" : stale ? "最近样本 · 已过期" : "CPU 使用率"}</text>
    <text x={200} y={267} textAnchor="middle" fontSize={9} fontWeight={600} fill="#6A6963">一格 = 1% 容量 · 从左向右读取</text>
  </svg>;
}

export function ResourceTicks({ rows, stale }) {
  return <div className={styles.tickRows} aria-label={`主机容量${stale ? "，数据已过期" : ""}`}>
    {rows.map((row, index) => <div className={styles.tickRow} key={row.label}>
      <div className={styles.tickLabel}><span>{row.label}</span><strong>{row.valueLabel || numberLabel(row.value)}<small>{finite(row.value) ? "%" : ""}</small></strong></div>
      <svg viewBox="0 0 420 40" role="img" aria-label={`${row.label} ${row.valueLabel || (finite(row.value) ? `${numberLabel(row.value)}%` : "无样本")}`}>
        <line x1={3} y1={26} x2={417} y2={26} stroke={GRID} strokeWidth={.7} />
        {Array.from({ length: 100 }, (_, k) => { const inked = finite(row.value) && k < Math.floor(Math.max(0, Math.min(100, row.value))), x = 4 + k * 4.16, height = 9 + rnd(k + 1, index + 2) * 6; return <g key={k}><line x1={x} y1={24} x2={x} y2={24 - height} stroke={inked ? INK : "#C6C5BF"} strokeWidth={inked ? .9 : .6} />{k % 10 === 9 && <circle cx={x} cy={30} r={.8} fill="#B0AFA9" />}</g>; })}
      </svg><p>{row.detail}</p>
    </div>)}
      <p className={styles.source}>一格 = 1% · 各项按自身总容量计算{stale ? " · 最近样本已过期" : " · 未知值保留空白"}</p>
  </div>;
}

export const HistoryChart = memo(function HistoryChart({ title, description, points = [], series, max, unit = "", format = (value) => numberLabel(value), area = false, loading, error, onRetry, source = "PROMETHEUS", intervalSeconds }) {
  const id = useId(), card = useRef(null), [chartWidth, setChartWidth] = useState(640), [hover, setHover] = useState(null), [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!card.current) return;
    const resize = () => setChartWidth(Math.max(320, Math.round(card.current.getBoundingClientRect().width)));
    resize(); const observer = new ResizeObserver(resize); observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  const geometry = useMemo(() => chartGeometry(points, series.map((item) => item.key), { max, width: chartWidth }), [points, series, max, chartWidth]);
  const selectedIndex = hover === null ? points.length - 1 : Math.min(points.length - 1, Math.max(0, hover)), selected = points[selectedIndex];
  const selectedX = selected ? geometry.x(Date.parse(selected.collectedAt)) : null;
  function move(event) {
    if (!points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect(), x = (event.clientX - bounds.left) / bounds.width * geometry.width;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round((x - geometry.left) / (geometry.right - geometry.left) * (points.length - 1)))));
  }
  function key(event) {
    if (!points.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); setHover(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, selectedIndex + (event.key === "ArrowRight" ? 1 : -1))));
  }
  return <section ref={card} className={styles.chartCard} aria-labelledby={id}>
    <div className={styles.chartHeading}><div><h2 id={id}>{title}</h2><p>{description}</p></div><span>{unit}</span></div>
    <div className={styles.legend}>{series.map((item, index) => <span key={item.key}><i style={{ background: LADDER[index % LADDER.length] }} data-dashed={index > 0} />{item.label}</span>)}</div>
    {error && geometry.hasData && <p className={styles.chartError} role="alert">历史更新失败，保留下方上次读取的样本。<button type="button" onClick={onRetry}>重试</button></p>}
    {loading && !points.length ? <div className={styles.emptyChart} role="status">正在读取真实历史样本…</div> : error && !geometry.hasData ? <div className={styles.emptyChart} role="alert"><p>{error}</p><button type="button" onClick={onRetry}>重新读取</button></div> : !geometry.hasData ? <div className={styles.emptyChart}><span className={styles.emptyDash}>—</span><p>这个时间窗口没有可用样本</p><small>等待采集；不以零填补缺失数据。</small></div> : <>
      <svg className={styles.historySvg} viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="group" tabIndex={0} aria-label={`${title}。左右方向键逐点查看，Home 与 End 跳至首尾。`} onPointerMove={move} onPointerLeave={() => { if (!focused) setHover(null); }} onFocus={() => { setFocused(true); setHover(points.length - 1); }} onBlur={() => { setFocused(false); setHover(null); }} onKeyDown={key}>
        {[0, .5, 1].map((ratio) => { const y = geometry.y(geometry.max * ratio); return <g key={ratio}><line x1={geometry.left} y1={y} x2={geometry.right} y2={y} stroke={GRID} strokeWidth={.7} strokeDasharray={ratio ? "2 5" : undefined} /><text x={geometry.left - 8} y={y + 3} textAnchor="end" fontSize={9} fontWeight={600} fill="#6A6963">{format(geometry.max * ratio)}</text></g>; })}
        {Array.from({ length: Math.min(points.length, 100) }, (_, index) => { const x = geometry.left + index / Math.max(1, Math.min(points.length, 100) - 1) * (geometry.right - geometry.left); return <line key={index} x1={x} x2={x} y1={geometry.base} y2={geometry.base - (index % 5 ? 4 : 7)} stroke="#C6C5BF" strokeWidth={.6} />; })}
        {geometry.series.map((item, index) => <g key={item.key}>
          {area && item.segments.flatMap((part) => part.filter((_, pointIndex) => pointIndex % Math.max(1, Math.ceil(points.length / 200)) === 0).map((point) => <line key={point.index} x1={point.x} x2={point.x} y1={geometry.base} y2={point.y} stroke={LADDER[index % LADDER.length]} strokeWidth={.55} />))}
          <path d={item.path} fill="none" stroke={LADDER[index % LADDER.length]} strokeWidth={index ? 1.2 : 1.5} strokeDasharray={index === 1 ? "5 3" : index === 2 ? "2 3" : index === 3 ? "8 3 2 3" : undefined} />
          {item.segments.filter((part) => part.length === 1).map((part) => <circle key={part[0].index} cx={part[0].x} cy={part[0].y} r={2} fill={LADDER[index % LADDER.length]} />)}
        </g>)}
        {[0, .5, 1].map((fraction) => <text key={fraction} x={geometry.left + fraction * (geometry.right - geometry.left)} y={geometry.base + 23} textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"} fontSize={9.5} fontWeight={600} fill="#6A6963">{monitorTime(new Date(geometry.start + fraction * (geometry.end - geometry.start)).toISOString(), true)}</text>)}
        {hover !== null && selected && <g><line x1={selectedX} x2={selectedX} y1={geometry.top} y2={geometry.base} stroke="#8F8E88" strokeWidth={.7} strokeDasharray="3 3" />{series.map((item, index) => finite(selected[item.key]) && <circle key={item.key} cx={selectedX} cy={geometry.y(selected[item.key])} r={3.5} fill={PAPER} stroke={LADDER[index % LADDER.length]} strokeWidth={1.5} />)}</g>}
      </svg>
      <div className={styles.chartReading} aria-live={focused ? "polite" : "off"}><time>{selected ? monitorTime(selected.collectedAt, true, true) : "—"}</time>{series.map((item) => <span key={item.key}>{item.label}<strong>{finite(selected?.[item.key]) ? `${format(selected[item.key])}${unit ? ` ${unit}` : ""}` : "无样本"}</strong></span>)}</div>
    </>}
    <p className={styles.source}>{source}{historyResolution(intervalSeconds) ? ` · ${historyResolution(intervalSeconds)}` : ""} · 缺失值断开 · 悬停 / 方向键读取</p>
  </section>;
});
