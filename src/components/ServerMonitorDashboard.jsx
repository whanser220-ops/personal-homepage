"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Clock3, Cpu,
  HardDrive, Layers3, LoaderCircle, LockKeyhole, LogOut, MemoryStick,
  Network, RefreshCw, Server, ShieldCheck,
} from "lucide-react";
import styles from "./ServerMonitorDashboard.module.css";

const RANGES = [
  { value: "1h", label: "1 小时", seconds: 3600 },
  { value: "24h", label: "24 小时", seconds: 86400 },
  { value: "7d", label: "7 天", seconds: 604800 },
];
const RESOURCE_SERIES = [
  { key: "cpuPercent", label: "CPU", color: "var(--chart-1)" },
  { key: "memoryPercent", label: "内存", color: "var(--chart-2)" },
  { key: "swapPercent", label: "Swap", color: "var(--chart-4)" },
  { key: "diskPercent", label: "磁盘", color: "var(--chart-3)" },
];
const NETWORK_SERIES = [
  { key: "rxBytesPerSecond", label: "接收", color: "var(--chart-2)" },
  { key: "txBytesPerSecond", label: "发送", color: "var(--chart-1)" },
];
const DISK_SERIES = [
  { key: "diskReadBytesPerSecond", label: "读取", color: "var(--chart-5)" },
  { key: "diskWriteBytesPerSecond", label: "写入", color: "var(--chart-1)" },
];
const validNumber = (value) => typeof value === "number" && Number.isFinite(value);
const percentage = (value) => validNumber(value) ? `${value.toFixed(1)}%` : "—";
const plainNumber = (value, digits = 2) => validNumber(value) ? value.toFixed(digits) : "—";

function bytes(value, digits = 1) {
  if (!validNumber(value) || value < 0) return "—";
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** unit).toFixed(unit ? digits : 0)} ${units[unit]}`;
}

function rate(value) {
  return validNumber(value) && value >= 0 ? `${bytes(value)}/s` : "—";
}

function dateLabel(value, withDate = true, withSeconds = withDate) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return "—";
  return time.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", month: withDate ? "2-digit" : undefined,
    day: withDate ? "2-digit" : undefined, hour: "2-digit", minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined, hour12: false,
  });
}

function uptime(seconds) {
  if (!validNumber(seconds)) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${days ? `${days} 天 ` : ""}${hours} 小时 ${minutes} 分钟`;
}

async function requestJson(url, signal, options = {}) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal, ...options });
  if (!response.ok) {
    const error = new Error(response.status === 401 ? "登录已过期，请重新登录。" : `请求失败（HTTP ${response.status}），稍后将自动重试。`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function Status({ tone = "neutral", children }) {
  return <span className={`${styles.status} ${styles[tone]}`}><span aria-hidden="true" />{children}</span>;
}

function Metric({ icon: Icon, label, value, detail, percent }) {
  return (
    <article className={styles.metric}>
      <div className={styles.metricLabel}><Icon size={16} aria-hidden="true" />{label}</div>
      <p className={styles.metricValue}>{value}</p>
      {validNumber(percent) && <div className={styles.meter} aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: percent >= 90 ? "var(--status-warning)" : undefined }} /></div>}
      <p className={styles.metricDetail}>{detail}</p>
    </article>
  );
}

function HistoryChart({ title, subtitle, points, series, intervalSeconds, range, endTime, percent = false, loading, error }) {
  const cardRef = useRef(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);
  const height = 190;
  const left = 60;
  const right = width - 14;
  const top = 12;
  const bottom = height - 30;
  const duration = RANGES.find((item) => item.value === range).seconds * 1000;
  const end = Number.isFinite(endTime) ? endTime : Date.now();
  const start = end - duration;
  const source = points || [];
  const visible = source.map((point) => ({ ...point, time: Date.parse(point?.collectedAt) }))
    .filter((point) => Number.isFinite(point.time) && point.time >= start && point.time <= end)
    .sort((a, b) => a.time - b.time);
  const values = visible.flatMap((point) => series.map((item) => point[item.key]).filter(validNumber));
  const ceiling = percent ? Math.max(100, ...values) : Math.max(1, ...values) * 1.12;
  const hasData = values.length > 0;
  const maxGap = Math.max(15, intervalSeconds || 15) * 1600;
  const x = (time) => left + (time - start) / duration * (right - left);
  const y = (value) => bottom - Math.max(0, value) / ceiling * (bottom - top);
  const paths = series.map((item) => {
    let previousTime = null;
    let path = "";
    for (const point of visible) {
      const value = point[item.key];
      if (!validNumber(value)) { previousTime = null; continue; }
      const connected = previousTime !== null && point.time - previousTime <= maxGap;
      path += `${connected ? "L" : "M"}${x(point.time).toFixed(2)},${y(value).toFixed(2)} `;
      previousTime = point.time;
    }
    return { ...item, path };
  });
  return (
    <article className={styles.chartCard} ref={cardRef}>
      <div className={styles.chartHeading}><div><h3>{title}</h3><p>{subtitle}</p></div>{loading && <LoaderCircle className={styles.spin} size={16} aria-label="正在更新曲线" />}</div>
      <div className={styles.legend}>{series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
      {error && <p className={styles.inlineError} role="status">{error}</p>}
      {hasData ? (
        <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}，最近${RANGES.find((item) => item.value === range).label}。曲线断点表示没有采样数据。`}>
          {[0, 0.5, 1].map((ratio) => <g key={ratio}><line x1={left} y1={y(ceiling * ratio)} x2={right} y2={y(ceiling * ratio)} className={styles.gridLine} /><text x={left - 10} y={y(ceiling * ratio) + 4} textAnchor="end">{percent ? `${Math.round(ceiling * ratio)}%` : bytes(ceiling * ratio, 0)}</text></g>)}
          {paths.map((item) => <path key={item.key} d={item.path} fill="none" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}
          {visible.map((point) => series.map((item) => validNumber(point[item.key]) && <circle key={`${point.time}-${item.key}`} cx={x(point.time)} cy={y(point[item.key])} r={visible.length < 10 ? 2.5 : 0.8} fill={item.color}><title>{dateLabel(point.collectedAt)} · {item.label} {percent ? percentage(point[item.key]) : rate(point[item.key])}</title></circle>))}
          {[0, 0.5, 1].map((ratio) => <text key={ratio} x={left + ratio * (right - left)} y={height - 6} textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"}>{dateLabel(start + duration * ratio, range === "7d", false)}</text>)}
        </svg>
      ) : <div className={styles.chartEmpty}>{loading ? "正在读取历史采样…" : error ? "历史数据暂不可用" : "这个时间段还没有采样数据"}<small>采集后会自动显示，缺失数据保留断点。</small></div>}
    </article>
  );
}

function serviceState(service) {
  if (service.status === "unhealthy") return { tone: "danger", label: "异常" };
  if (service.status === "unknown") return { tone: "neutral", label: "未知" };
  if (service.kind === "tcp") return { tone: "info", label: "端口可达" };
  if (service.kind === "process") return { tone: "success", label: "进程运行" };
  if (service.status === "reachable") return { tone: "info", label: "HTTP 可达" };
  return { tone: "success", label: "健康" };
}

export function ServerMonitorDashboard() {
  const [session, setSession] = useState(null);
  const [sessionError, setSessionError] = useState("");
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [current, setCurrent] = useState(null);
  const [currentLoaded, setCurrentLoaded] = useState(false);
  const [history, setHistory] = useState(null);
  const [range, setRange] = useState("1h");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [currentError, setCurrentError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [now, setNow] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get("error");
    if (errorCode) setLoginError(errorCode === "access_denied" || errorCode === "forbidden" ? "这个 Google 账号没有监控访问权限。请使用指定的已验证邮箱登录。" : "Google 登录未完成，请重新登录。若持续失败，请检查 OAuth 配置。");
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    const timeout = setTimeout(() => controller.abort(), 12000);
    setSessionError("");
    requestJson("/api/monitor/auth/session", controller.signal)
      .then((value) => { if (!stopped) setSession(value); })
      .catch((error) => { if (!stopped) setSessionError(controller.signal.aborted ? "登录状态读取超时，请重试。" : error.message); })
      .finally(() => clearTimeout(timeout));
    return () => { stopped = true; clearTimeout(timeout); controller.abort(); };
  }, [sessionAttempt]);

  useEffect(() => {
    if (!session?.authenticated) return;
    let stopped = false;
    let busy = false;
    let controller;
    setHistory(null);
    async function load() {
      if (busy || stopped) return;
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      setLoading(true);
      const results = await Promise.allSettled([
        requestJson("/api/monitor/current", controller.signal),
        requestJson(`/api/monitor/history?range=${range}`, controller.signal),
      ]);
      clearTimeout(timeout);
      if (stopped) return;
      if (results.some((result) => result.status === "rejected" && result.reason.status === 401)) {
        setSession((previous) => ({ ...previous, authenticated: false }));
        setCurrent(null); setHistory(null); setCurrentLoaded(false);
        setLoginError("登录已过期，请重新登录。");
      } else {
        const [latest, historical] = results;
        if (latest.status === "fulfilled") {
          setCurrent(latest.value); setCurrentError(""); setCurrentLoaded(true);
          const serverTime = Date.parse(latest.value.serverTime);
          if (Number.isFinite(serverTime)) setClockOffset(serverTime - Date.now());
        } else setCurrentError(latest.reason.name === "AbortError" ? "实时数据读取超时，稍后将自动重试。" : latest.reason.message);
        if (historical.status === "fulfilled") { setHistory(historical.value); setHistoryError(""); }
        else setHistoryError(historical.reason.name === "AbortError" ? "历史数据读取超时，稍后将自动重试。" : historical.reason.message);
      }
      setLoading(false);
      busy = false;
    }
    load();
    const interval = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(interval); controller?.abort(); };
  }, [session?.authenticated, range, refresh]);

  async function logout() {
    setLoggingOut(true); setLogoutError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      await requestJson("/api/monitor/auth/logout", controller.signal, { method: "POST" });
      setSession((previous) => ({ ...previous, authenticated: false }));
      setCurrent(null); setHistory(null); setCurrentLoaded(false); setLoginError("");
    } catch { setLogoutError("退出失败，请重试。"); }
    finally { clearTimeout(timeout); setLoggingOut(false); }
  }

  const sample = current?.sample;
  const host = sample?.host;
  const collectedAt = Date.parse(sample?.collectedAt);
  const sampleAge = Number.isFinite(collectedAt) ? Math.max(0, (now + clockOffset - collectedAt) / 1000) : null;
  const stale = Boolean(sample && (current.stale || sampleAge === null || sampleAge > 45));
  const services = sample?.services || [];
  const containers = sample?.containers || [];
  const abnormalServices = services.filter((service) => service.status === "unhealthy").length;
  const unknownServices = services.filter((service) => service.status === "unknown").length;
  const historyEnd = Date.parse(current?.serverTime);
  const chartProps = useMemo(() => ({ points: history?.points || [], intervalSeconds: history?.intervalSeconds, range, endTime: historyEnd, loading, error: historyError }), [history, range, historyEnd, loading, historyError]);

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}><span />Infrastructure · Private</p><h1>服务监控<span>.</span></h1><p className={styles.intro}>看见服务器的此刻，也读懂过去的变化。</p></div>
        <div className={styles.heroMeta}><span><LockKeyhole size={13} aria-hidden="true" />私有访问</span><span>单主机 / 7 天历史</span></div>
      </header>

      {!session?.authenticated ? (
        <section className={styles.loginPanel} aria-labelledby="private-title">
          <div className={styles.loginCopy}><div className={styles.privateIcon}><ShieldCheck size={26} aria-hidden="true" /></div><p className={styles.kicker}>ONLY FOR THE OWNER</p><h2 id="private-title">一台服务器，<br />一个安静的观察窗口。</h2><p>资源趋势、应用检查与容器状态，集中在这里。监控数据仅在授权账号登录后可见。</p><div className={styles.loginFacts}><span>15 秒采样</span><span>7 天留存</span><span>本机视角</span></div></div>
          <div className={styles.loginAction}>
            <LockKeyhole size={25} className={styles.loginLock} aria-hidden="true" />
            <h3>{!session && !sessionError ? "正在确认访问权限" : "登录私有看板"}</h3>
            <p>仅限已授权的 Google 账号。</p>
            {loginError && <p className={styles.inlineError} role="alert">{loginError}</p>}
            {sessionError ? <><p className={styles.inlineError} role="alert">{sessionError}</p><button className={styles.primaryButton} onClick={() => setSessionAttempt((value) => value + 1)}><RefreshCw size={16} />重试</button></> : !session ? <div className={styles.authLoading}><LoaderCircle className={styles.spin} size={18} />读取登录状态…</div> : session.configured ? <a className={styles.primaryButton} href="/api/monitor/auth/google/start"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.3-.2-2H12V14h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3ZM12 22c2.7 0 5-.9 6.6-2.5L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H3v2.6A10 10 0 0 0 12 22ZM6.3 13.8a6 6 0 0 1 0-3.6V7.6H3a10 10 0 0 0 0 8.8l3.3-2.6ZM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.6l3.3 2.6C7.1 7.8 9.4 6 12 6Z" /></svg>使用 Google 登录<ArrowRight size={16} /></a> : <div className={styles.configNotice} role="status">Google 登录尚未配置，当前无法访问监控数据。请完成服务端 OAuth 配置后重试。</div>}
            <small>身份验证通过后才会请求监控数据。</small>
          </div>
        </section>
      ) : (
        <>
          <section className={styles.toolbar} aria-label="监控操作">
            <div className={styles.hostIdentity}><Server size={19} aria-hidden="true" /><div><strong>{host?.hostname || "云服务器"}</strong><span>{sample?.hostId || "服务器本机视角"}</span></div></div>
            <div className={styles.toolbarActions}><span className={styles.account}>{session.email || "已授权账号"}</span><button className={styles.iconButton} disabled={loading} onClick={() => setRefresh((value) => value + 1)} aria-label="刷新监控数据" title="刷新监控数据"><RefreshCw className={loading ? styles.spin : ""} size={16} /></button><button className={styles.textButton} onClick={logout} disabled={loggingOut}><LogOut size={15} />{loggingOut ? "退出中…" : "退出"}</button></div>
          </section>
          {logoutError && <p className={styles.errorBanner} role="alert">{logoutError}</p>}
          {currentError && <p className={styles.errorBanner} role="alert">{currentError}{sample ? " 当前保留最近一次采样。" : ""}</p>}
          <div className={styles.sampleBar} role="status"><Status tone={sample ? stale ? "warning" : "success" : "neutral"}>{sample ? stale ? "数据已过期" : "采样持续更新" : loading ? "正在读取采样" : "等待首条采样"}</Status><span>{sample ? `最后采样 ${dateLabel(sample.collectedAt)}${sampleAge !== null ? ` · ${Math.floor(sampleAge)} 秒前` : ""}` : "采集器每 15 秒提交一次，超过 45 秒无新数据会标记为过期。"}</span><small>北京时间</small></div>
          {stale && <p className={styles.staleNotice}>超过 45 秒没有新采样。以下为历史快照，不能代表服务器当前状态。</p>}

          {host ? (
            <>
              <section className={styles.metrics} aria-label="宿主机资源">
                <Metric icon={Cpu} label="CPU 使用率" value={percentage(host.cpu?.percent)} percent={host.cpu?.percent} detail={`${host.cpu?.cores ?? "—"} 核 · 1/5/15 分钟负载 ${plainNumber(host.cpu?.load1)} / ${plainNumber(host.cpu?.load5)} / ${plainNumber(host.cpu?.load15)}`} />
                <Metric icon={MemoryStick} label="内存" value={percentage(host.memory?.usedPercent)} percent={host.memory?.usedPercent} detail={`${bytes(host.memory?.usedBytes)} / ${bytes(host.memory?.totalBytes)} · 可用 ${bytes(host.memory?.availableBytes)}`} />
                <Metric icon={Layers3} label="Swap" value={host.swap?.totalBytes === 0 ? "未启用" : percentage(host.swap?.usedPercent)} percent={host.swap?.totalBytes > 0 ? host.swap?.usedPercent : undefined} detail={`${bytes(host.swap?.usedBytes)} / ${bytes(host.swap?.totalBytes)}`} />
                <Metric icon={HardDrive} label={`磁盘 ${host.disk?.mount || "/"}`} value={percentage(host.disk?.usedPercent)} percent={host.disk?.usedPercent} detail={`${bytes(host.disk?.usedBytes)} / ${bytes(host.disk?.totalBytes)} · 可用 ${bytes(host.disk?.availableBytes)}`} />
              </section>
              <section className={styles.activityRow} aria-label="速率与运行时间">
                <div><Network size={17} aria-hidden="true" /><span>网络 <small>{host.network?.interface || "—"}</small></span><strong><ArrowDownLeft size={13} />{rate(host.network?.rxBytesPerSecond)}</strong><strong><ArrowUpRight size={13} />{rate(host.network?.txBytesPerSecond)}</strong></div>
                <div><HardDrive size={17} aria-hidden="true" /><span>磁盘 I/O</span><strong>读 {rate(host.disk?.readBytesPerSecond)}</strong><strong>写 {rate(host.disk?.writeBytesPerSecond)}</strong></div>
                <div><Clock3 size={17} aria-hidden="true" /><span>运行时间</span><strong>{uptime(host.uptimeSeconds)}</strong></div>
              </section>
            </>
          ) : <div className={styles.emptyPanel}><Activity size={28} aria-hidden="true" /><h2>{!currentLoaded && loading ? "正在读取服务器状态" : "等待服务器的第一条采样"}</h2><p>{currentError ? "暂时无法连接监控接口，系统会自动重试。" : "采集器提交数据后，资源、应用与容器状态会自动出现在这里。"}</p></div>}

          <section className={styles.historySection} aria-labelledby="history-title">
            <div className={styles.sectionHeading}><div><p className={styles.kicker}>RESOURCE HISTORY</p><h2 id="history-title">资源的变化</h2></div><div className={styles.rangeTabs} role="group" aria-label="历史时间范围">{RANGES.map((item) => <button key={item.value} aria-pressed={range === item.value} className={range === item.value ? styles.selectedRange : ""} onClick={() => setRange(item.value)}>{item.label}</button>)}</div></div>
            <HistoryChart title="资源使用率" subtitle="CPU、内存、Swap 与磁盘容量占比" series={RESOURCE_SERIES} percent {...chartProps} />
            <div className={styles.twoCharts}><HistoryChart title="网络收发" subtitle="每秒接收与发送的字节数" series={NETWORK_SERIES} {...chartProps} /><HistoryChart title="磁盘读写" subtitle="宿主机块设备每秒读写字节数" series={DISK_SERIES} {...chartProps} /></div>
            <p className={styles.chartNote}>按时间窗口聚合 · 缺失采样保留断点 · 速率使用二进制单位（KiB / MiB）</p>
          </section>

          <section className={styles.servicesSection} aria-labelledby="services-title">
            <div className={styles.sectionHeading}><div><p className={styles.kicker}>APPLICATION CHECKS</p><h2 id="services-title">应用与服务</h2></div><span className={styles.sectionSummary}>{services.length ? `${services.length} 项检查 · ${abnormalServices} 项异常${unknownServices ? ` · ${unknownServices} 项未知` : ""}` : "等待检查结果"}</span></div>
            <div className={styles.serviceGrid}>{services.map((service) => { const state = serviceState(service); return <article className={styles.serviceCard} key={service.id}><div className={styles.serviceHeading}><h3>{service.name}</h3><Status tone={state.tone}>{state.label}</Status></div><p className={styles.checkKind}>{service.kind === "http" ? "HTTP 健康检查" : service.kind === "process" ? "进程运行检查" : "TCP 端口检查"}<span>{validNumber(service.latencyMs) ? `${Math.round(service.latencyMs)} ms` : "—"}</span></p><p className={styles.serviceDetail}>{service.detail || (service.kind === "tcp" ? "仅代表端口可连接，未验证应用功能。" : service.kind === "process" ? "仅代表进程存在，未验证应用功能。" : "未提供进一步检查说明。")}</p>{service.httpStatus && <span className={styles.httpCode}>HTTP {service.httpStatus}{service.httpStatus >= 300 && service.httpStatus < 400 ? " · 重定向" : ""}</span>}</article>; })}</div>
            {!services.length && <p className={styles.emptyList}>暂无服务检查结果。</p>}
          </section>

          <section className={styles.containersSection} aria-labelledby="containers-title">
            <div className={styles.sectionHeading}><div><p className={styles.kicker}>CONTAINER INVENTORY</p><h2 id="containers-title">Docker 容器</h2></div><span className={styles.sectionSummary}>{containers.length} 个容器</span></div>
            <div className={styles.tableWrap}><table className={styles.containerTable}><caption className={styles.srOnly}>Docker 容器资源、健康状态、重启次数和镜像版本</caption><thead><tr><th scope="col">容器 / 运行镜像</th><th scope="col">状态</th><th scope="col">健康检查</th><th scope="col">CPU</th><th scope="col">内存</th><th scope="col">重启</th></tr></thead><tbody>{containers.map((container) => <tr key={container.name}><td><strong>{container.name}</strong><code>{container.image || "—"}</code></td><td><Status tone={container.state === "running" ? "success" : container.state === "exited" || container.state === "dead" ? "danger" : "neutral"}>{({ running: "运行中", exited: "已退出", restarting: "重启中", paused: "已暂停", created: "已创建", dead: "已停止" })[container.state] || container.state || "未知"}</Status></td><td><span className={container.health === "unhealthy" ? styles.badHealth : ""}>{({ healthy: "健康", unhealthy: "不健康", starting: "启动检查中", none: "未配置" })[container.health] || "未配置"}</span></td><td>{percentage(container.cpuPercent)}</td><td>{bytes(container.memoryBytes)}<small>{validNumber(container.memoryPercent) ? `${percentage(container.memoryPercent)} · ` : ""}{container.memoryLimitBytes > 0 ? `上限 ${bytes(container.memoryLimitBytes)}` : "无内存上限数据"}</small></td><td>{container.restartCount ?? "—"}</td></tr>)}</tbody></table>{!containers.length && <p className={styles.emptyList}>暂无容器采样。</p>}</div>
          </section>
        </>
      )}
      <aside className={styles.perspective}><ShieldCheck size={17} aria-hidden="true" /><p><strong>服务器本机视角</strong> · HTTP 健康检查、进程运行与端口可达分别展示；认证重定向不直接判为故障。这里反映单台服务器内部的观察结果，公网独立可用性需要外部探测。</p></aside>
    </main>
  );
}
