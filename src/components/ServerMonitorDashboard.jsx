"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, LoaderCircle, LockKeyhole, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { CpuGauge, HistoryChart, ResourceTicks } from "./MonitorCharts.jsx";
import { createMonitorPoller } from "./monitorPolling.js";
import { MONITOR_RANGES, MONITOR_SERVICES, MONITOR_VIEWS, SIGNAL_METRICS, bytesLabel, effectiveContainer, effectiveService, finite, monitorFreshness, monitorTime, monitorViewHash, numberLabel, parseMonitorView, signalMessage, uptimeLabel } from "./monitorView.js";
import styles from "./ServerMonitorDashboard.module.css";

const VIEW_STORAGE = "server-monitor-native-view";
const CAPACITY_SERIES = [{ key: "cpuPercent", label: "CPU" }, { key: "memoryPercent", label: "内存" }, { key: "swapPercent", label: "Swap" }, { key: "diskPercent", label: "磁盘" }];
const DISK_SERIES = [{ key: "diskReadBytesPerSecond", label: "读取" }, { key: "diskWriteBytesPerSecond", label: "写入" }];
const NETWORK_SERIES = [{ key: "rxBytesPerSecond", label: "接收" }, { key: "txBytesPerSecond", label: "发送" }];
const kibibyteRate = (value) => numberLabel(value / 1024);

function useMonitorResource(url, enabled, intervalMs, attempt, onUnauthorized) {
  const [state, setState] = useState({ url, data: null, error: "", loading: true });
  useEffect(() => {
    if (!enabled) { setState({ url, data: null, error: "", loading: false }); return; }
    setState({ url, data: null, error: "", loading: true });
    const poller = createMonitorPoller({ url, intervalMs, timeoutMs: intervalMs < 10000 ? 8000 : 15000,
      isVisible: () => document.visibilityState !== "hidden",
      onData: (data) => setState({ url, data, error: "", loading: false }),
      onError: (error) => setState((previous) => ({ ...previous, url, error, loading: false })), onUnauthorized });
    document.addEventListener("visibilitychange", poller.refresh);
    return () => { poller.stop(); document.removeEventListener("visibilitychange", poller.refresh); };
  }, [url, enabled, intervalMs, attempt, onUnauthorized]);
  return state.url === url && enabled ? state : { url, data: null, error: "", loading: enabled };
}

function Stamp({ label, value, status }) {
  return <div className={styles.stamp} data-stale={status.stale}><span className={styles.statusMark} aria-hidden="true">{status.stale ? "○" : "●"}</span><span>{label}</span><strong>{status.text}</strong><time dateTime={value || undefined}>{monitorTime(value)}</time></div>;
}
function DataError({ label, error, retry }) { return error ? <div className={styles.errorBanner} role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{label}：{error}</span><button type="button" onClick={retry}>重试</button></div> : null; }
function Stat({ index, title, value, unit, note, stale }) { return <article className={styles.stat}><div className={styles.statTop}><span>{index}</span><h2>{title}</h2></div><p className={styles.statValue}>{value}<small>{unit}</small></p><p className={styles.statNote}>{stale ? "最近样本 · 数据已过期" : note}</p></article>; }

export function ServerMonitorDashboard() {
  const [session, setSession] = useState(null), [sessionError, setSessionError] = useState(""), [sessionAttempt, setSessionAttempt] = useState(0);
  const [loginError, setLoginError] = useState(""), [logoutError, setLogoutError] = useState(""), [loggingOut, setLoggingOut] = useState(false);
  const [selection, setSelection] = useState({ view: "overview", range: "1h", service: "all" }), [signalMetric, setSignalMetric] = useState("requestsPerSecond");
  const [attempt, setAttempt] = useState(0), [now, setNow] = useState(0), [clockOffset, setClockOffset] = useState(0);
  const epoch = useRef(0), tabs = useRef([]);
  const clearPrivateState = useCallback(() => { epoch.current++; setSession((previous) => ({ authenticated: false, configured: previous?.configured })); setLoginError("登录已过期，请重新登录。"); }, []);
  const enabled = Boolean(session?.authenticated && !loggingOut), trends = selection.view === "trends";
  const current = useMonitorResource("/api/monitor/current", enabled, 3000, attempt, clearPrivateState);
  const signals = useMonitorResource(`/api/monitor/signals/current?service=${selection.service}`, enabled && selection.view !== "infrastructure", 3000, attempt, clearPrivateState);
  const history = useMonitorResource(`/api/monitor/history?range=${selection.range}`, enabled && trends, 30000, attempt, clearPrivateState);
  const signalHistory = useMonitorResource(`/api/monitor/signals/history?service=${selection.service}&range=${selection.range}`, enabled && trends, 30000, attempt, clearPrivateState);

  useEffect(() => {
    let remembered = ""; try { remembered = sessionStorage.getItem(VIEW_STORAGE) || ""; } catch {}
    setSelection(parseMonitorView(window.location.hash || remembered));
    const sync = () => setSelection(parseMonitorView(window.location.hash));
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason) setLoginError(["access_denied", "forbidden"].includes(reason) ? "这个 Google 账号没有访问权限，请使用已授权的账号。" : "Google 登录未完成，请重新登录。");
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("hashchange", sync); window.addEventListener("popstate", sync);
    return () => { clearInterval(timer); window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(), generation = epoch.current; let stopped = false;
    const timer = setTimeout(() => controller.abort(), 12000); setSessionError("");
    fetch("/api/monitor/auth/session", { cache: "no-store", credentials: "same-origin", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("暂时无法读取登录状态，请重试。");
      const value = await response.json(); if (!stopped && generation === epoch.current) { setSession(value); if (value.authenticated) setLoginError(""); }
    }).catch((error) => { if (!stopped && generation === epoch.current) setSessionError(error.name === "AbortError" ? "登录状态读取超时，请重试。" : error.message); }).finally(() => clearTimeout(timer));
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [sessionAttempt]);
  useEffect(() => { const serverTime = Date.parse(current.data?.serverTime); if (Number.isFinite(serverTime)) setClockOffset(serverTime - Date.now()); }, [current.data]);

  function remember(value = selection) { try { sessionStorage.setItem(VIEW_STORAGE, monitorViewHash(value)); } catch {} }
  function navigate(change) { const next = { ...selection, ...change }; setSelection(next); remember(next); window.history.pushState(null, "", monitorViewHash(next)); }
  function tabKey(event, index) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? MONITOR_VIEWS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + MONITOR_VIEWS.length) % MONITOR_VIEWS.length;
    navigate({ view: MONITOR_VIEWS[next].id }); tabs.current[next]?.focus();
  }
  async function logout() {
    setLoggingOut(true); setLogoutError(""); const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/monitor/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("logout_failed");
      epoch.current++; setSession((previous) => ({ authenticated: false, configured: previous?.configured })); setLoginError("");
    } catch { setLogoutError("退出失败，请重试。"); } finally { clearTimeout(timer); setLoggingOut(false); }
  }

  const retry = useCallback(() => setAttempt((value) => value + 1), []), view = MONITOR_VIEWS.find((item) => item.id === selection.view);
  const sample = enabled ? current.data?.sample : null, host = sample?.host;
  const time = now + clockOffset, hostFresh = monitorFreshness(sample?.collectedAt, time, current.data?.stale), checksFresh = monitorFreshness(sample?.checksCollectedAt, time, current.data?.checksStale);
  const signalData = enabled ? signals.data : null, signalFresh = monitorFreshness(signalData?.collectedAt, time, signalData?.stale, signalData?.staleAfterSeconds || 9, true);
  const metrics = signalData?.metrics, saturation = finite(host?.cpu?.load1) && host?.cpu?.cores > 0 ? host.cpu.load1 / host.cpu.cores : null;
  const services = (sample?.services || []).map((service) => effectiveService(service, checksFresh.stale)), containers = (sample?.containers || []).map((container) => effectiveContainer(container, checksFresh.stale));
  const failedServices = services.filter((service) => service.status === "unhealthy"), unknownServices = services.filter((service) => service.status === "unknown");
  const activeMetric = SIGNAL_METRICS.find((item) => item.id === signalMetric);
  const activeSeries = useMemo(() => [{ key: activeMetric.id, label: activeMetric.label }], [activeMetric]);
  const activeFormat = useCallback((value) => numberLabel(value, activeMetric.digits), [activeMetric]);
  const authPending = !session && !sessionError, period = MONITOR_RANGES.find((item) => item.id === selection.range)?.label;

  return <div className={styles.page}>
    <a href="#monitor-main" className={styles.skip} onClick={(event) => { event.preventDefault(); document.getElementById("monitor-main")?.focus(); }}>跳到监控内容</a>
    <div className={styles.wrap}>
      <header className={styles.topbar}><Link href="/" className={styles.brand} aria-label="返回个人网站"><span className={styles.brandMark}>H.</span><span>HUANG<span className={styles.brandDivider}>/</span>服务监控</span></Link><div className={styles.topActions}>{session?.authenticated && <><span className={styles.identity}><ShieldCheck size={13} aria-hidden="true" />{session.email}</span><button type="button" onClick={retry} disabled={loggingOut} className={styles.iconButton} title="重新读取监控数据" aria-label="重新读取监控数据"><RefreshCw size={16} aria-hidden="true" /></button><button type="button" onClick={logout} disabled={loggingOut} className={styles.iconButton} title="退出监控" aria-label="退出监控">{loggingOut ? <LoaderCircle size={16} className={styles.spin} /> : <LogOut size={16} aria-hidden="true" />}</button></>}<span className={styles.privateLabel}>PRIVATE / 私有</span></div></header>
      <main id="monitor-main" tabIndex={-1}>
        <section className={styles.heading}><div><p className={styles.eyebrow}>SERVER OBSERVATORY<span> / </span>服务器观测</p><h1>{session?.authenticated ? view.label : "服务器，清晰可见"}<span className={styles.headingPeriod} aria-hidden="true">.</span></h1><p className={styles.description}>{session?.authenticated ? view.description : "一台服务器的运行记录，一个安静的观察窗口。"}</p></div><div className={styles.edition}><span>单主机 / CLOUD PRIMARY</span><strong>{session?.authenticated ? view.number : "01"}<small> / 03</small></strong><span>服务器本机视角</span></div></section>

        {!session?.authenticated ? <section className={styles.loginPanel} aria-labelledby="login-title"><div><span className={styles.sectionNumber}>访问权限 / ACCESS</span><h2 id="login-title">仅对已授权的<br />Google 账号开放。</h2><p>真实采样、最近七天的变化，以及每一项服务检查。</p><div className={styles.loginFacts}><span><b>03</b>秒主机采样</span><span><b>15</b>秒服务检查</span><span><b>07</b>天历史记录</span></div></div><div className={styles.loginAction}><LockKeyhole size={29} strokeWidth={1.3} aria-hidden="true" /><h3>{authPending ? "正在确认访问权限" : "登录私有监控"}</h3><p>使用已授权账号继续。</p>{loginError && <p role="alert" className={styles.formError}>{loginError}</p>}{sessionError ? <><p className={styles.formError} role="alert">{sessionError}</p><button className={styles.primaryButton} type="button" onClick={() => setSessionAttempt((value) => value + 1)}>重新读取登录状态<RefreshCw size={15} /></button></> : authPending ? <p role="status" className={styles.loadingLabel}><LoaderCircle size={16} className={styles.spin} />读取登录状态…</p> : session?.configured ? <a href="/api/monitor/auth/google/start" onClick={() => remember()} className={styles.primaryButton}>使用 Google 登录<ArrowRight size={17} aria-hidden="true" /></a> : <p className={styles.formError}>Google 登录尚未配置，暂时无法访问。</p>}<small>通过身份验证后才会请求监控数据。</small></div></section> : loggingOut ? <div className={styles.pageLoading} role="status"><LoaderCircle size={20} className={styles.spin} />正在结束登录会话…</div> : <>
          <DataError label="退出" error={logoutError} retry={logout} /><DataError label="主机与服务" error={current.error} retry={retry} />
          <div className={styles.freshnessStrip}><Stamp label="主机" value={sample?.collectedAt} status={hostFresh} /><Stamp label="服务检查" value={sample?.checksCollectedAt} status={checksFresh} />{selection.view !== "infrastructure" && <Stamp label="HTTP 入口" value={signalData?.collectedAt} status={signalFresh} />}<span className={styles.freshnessHint}>北京时间 · 主机/检查 45 秒、HTTP 9 秒后标记过期</span></div>
          <div className={styles.toolbar}><div role="tablist" aria-label="监控视图" className={styles.tabs}>{MONITOR_VIEWS.map((item, index) => <button key={item.id} ref={(element) => { tabs.current[index] = element; }} id={`monitor-tab-${item.id}`} type="button" role="tab" aria-selected={selection.view === item.id} aria-controls="monitor-panel" tabIndex={selection.view === item.id ? 0 : -1} onClick={() => navigate({ view: item.id })} onKeyDown={(event) => tabKey(event, index)}><span>{item.number}</span>{item.label}</button>)}</div><div className={styles.contextControls}>{selection.view !== "infrastructure" && <label className={styles.selectLabel}>应用<select aria-label="选择应用" value={selection.service} onChange={(event) => navigate({ service: event.target.value })}>{MONITOR_SERVICES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>}{trends && <div className={styles.ranges} role="group" aria-label="历史时间范围">{MONITOR_RANGES.map((item) => <button type="button" key={item.id} aria-pressed={selection.range === item.id} onClick={() => navigate({ range: item.id })}>{item.label}</button>)}</div>}</div></div>
          <div id="monitor-panel" role="tabpanel" aria-labelledby={`monitor-tab-${selection.view}`} className={styles.panel}>
            {selection.view === "overview" && <>
              <DataError label="HTTP 信号" error={signals.error} retry={retry} />
              <div className={styles.stats}><Stat index="I" title="请求流量" value={numberLabel(metrics?.requestsPerSecond, 2)} unit={finite(metrics?.requestsPerSecond) ? "req/s" : ""} note="最近 1 分钟平均" stale={Boolean(signalData?.collectedAt) && signalFresh.stale} /><Stat index="II" title="服务端错误" value={numberLabel(metrics?.serverErrorPercent, 2)} unit={finite(metrics?.serverErrorPercent) ? "%" : ""} note={signalData?.trafficState === "no_traffic" ? "无请求时不计算错误率" : "5xx / 全部请求 · 1 分钟"} stale={Boolean(signalData?.collectedAt) && signalFresh.stale} /><Stat index="III" title="成功请求 P95" value={numberLabel(metrics?.successP95Ms)} unit={finite(metrics?.successP95Ms) ? "ms" : ""} note="成功请求的延迟 · 最近 5 分钟" stale={Boolean(signalData?.collectedAt) && signalFresh.stale} /><Stat index="IV" title="负载 / CPU 核" value={numberLabel(saturation, 2)} unit="" note="1 分钟系统负载 ÷ CPU 核数" stale={Boolean(host) && hostFresh.stale} /></div>
              <p className={styles.signalNote}>{signalMessage(signalData, signalFresh.stale)}{signalData?.parseErrorsTotal > 0 ? ` 入口日志累计 ${numberLabel(signalData.parseErrorsTotal, 0)} 条未解析。` : ""}</p>
              <div className={styles.overviewGrid}>
                <section className={styles.cpuCard}><div className={styles.cardHeading}><span className={styles.sectionNumber}>A / PROCESSOR</span><h2>{hostFresh.stale && host ? "最近的 CPU 占用" : "CPU 的此刻占用"}</h2><p>{finite(host?.cpu?.cores) ? `${host.cpu.cores} 核` : "等待主机样本"} · 主机真实采样</p></div><CpuGauge value={host?.cpu?.percent} stale={Boolean(host) && hostFresh.stale} /><div className={styles.loadList}><span>系统负载</span>{[["1 分钟", host?.cpu?.load1], ["5 分钟", host?.cpu?.load5], ["15 分钟", host?.cpu?.load15]].map(([label, value]) => <div key={label}><strong>{numberLabel(value, 2)}</strong><small>{label}</small></div>)}</div><p className={styles.source}>NODE EXPORTER · 主机真实采样</p></section>
                <section className={styles.capacityCard}><div className={styles.cardHeading}><span className={styles.sectionNumber}>B / CAPACITY</span><h2>容量的使用与余量</h2><p>各项独立计算，不表示同一个总量的构成。</p></div><ResourceTicks stale={Boolean(host) && hostFresh.stale} rows={[{ label: "内存", value: host?.memory?.usedPercent, detail: `${bytesLabel(host?.memory?.usedBytes)} 已用 / ${bytesLabel(host?.memory?.totalBytes)} 总量` }, { label: "Swap", value: host?.swap?.totalBytes === 0 ? null : host?.swap?.usedPercent, valueLabel: host?.swap?.totalBytes === 0 ? "未启用" : null, detail: host?.swap?.totalBytes === 0 ? "主机未配置 Swap" : `${bytesLabel(host?.swap?.usedBytes)} 已用 / ${bytesLabel(host?.swap?.totalBytes)} 总量` }, { label: host?.disk?.mount ? `磁盘 ${host.disk.mount}` : "磁盘", value: host?.disk?.usedPercent, detail: `${bytesLabel(host?.disk?.availableBytes)} 可用 / ${bytesLabel(host?.disk?.totalBytes)} 总量` }]} /></section>
                <aside className={styles.hostCard}><div className={styles.cardHeading}><span className={styles.sectionNumber}>C / HOST NOTES</span><h2>主机札记</h2></div><dl className={styles.hostFacts}><div><dt>主机名</dt><dd className={styles.hostname}>{host?.hostname || "等待采样"}</dd></div><div><dt>运行时间</dt><dd>{uptimeLabel(host?.uptimeSeconds)}</dd></div><div><dt>网络接收 / 发送</dt><dd>{bytesLabel(host?.network?.rxBytesPerSecond, true)}<br />{bytesLabel(host?.network?.txBytesPerSecond, true)}</dd></div><div><dt>磁盘读取 / 写入</dt><dd>{bytesLabel(host?.disk?.readBytesPerSecond, true)}<br />{bytesLabel(host?.disk?.writeBytesPerSecond, true)}</dd></div></dl><p className={styles.source}>网卡 {host?.network?.interface || "—"} · 最近真实采样</p></aside>
              </div>
              <section className={styles.statusSummary}><div><span className={styles.sectionNumber}>运行检查 / CHECKS</span><h2>{!services.length ? "等待服务检查" : checksFresh.stale ? "服务检查数据已过期" : failedServices.length ? `${failedServices.length} 项检查需要关注` : unknownServices.length ? `${unknownServices.length} 项检查状态未知` : "检查结果已更新"}</h2><p>{services.length} 项服务检查 · {containers.length} 个容器 · HTTP、进程与端口分别判定。</p></div><button type="button" className={styles.textButton} onClick={() => navigate({ view: "infrastructure" })}>查看基础设施<ArrowRight size={16} aria-hidden="true" /></button></section>
            </>}
            {trends && <>
              <div className={styles.trendIntro}><div><span className={styles.sectionNumber}>TIME SERIES / {period}</span><h2>沿着时间，读出变化。</h2><p>每 30 秒读取历史。缺失样本保持断点，不补零、不延长上次读数。</p></div><label className={styles.selectLabel}>HTTP 信号<select value={signalMetric} onChange={(event) => setSignalMetric(event.target.value)}>{SIGNAL_METRICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
              <div className={styles.chartGrid}>
                <HistoryChart title={activeMetric.label} description={`${MONITOR_SERVICES.find((item) => item.id === selection.service)?.label} · ${activeMetric.note} · ${period}`} intervalSeconds={signalHistory.data?.intervalSeconds} points={signalHistory.data?.points} series={activeSeries} max={activeMetric.id.endsWith("Percent") ? 100 : undefined} unit={activeMetric.unit} format={activeFormat} loading={signalHistory.loading} error={signalHistory.error} onRetry={retry} />
                <HistoryChart title="资源容量随时间的变化" description={`CPU / 内存 / Swap / 磁盘 · 各自容量百分比 · ${period}`} source="PROMETHEUS / POSTGRESQL" intervalSeconds={history.data?.intervalSeconds} points={history.data?.points} series={CAPACITY_SERIES} max={100} unit="%" loading={history.loading} error={history.error} onRetry={retry} />
                <HistoryChart title="磁盘在读，也在写" description={`发丝从零基线连接至真实速率 · ${period}`} source="PROMETHEUS / POSTGRESQL" intervalSeconds={history.data?.intervalSeconds} points={history.data?.points} series={DISK_SERIES} area unit="KiB/s" format={kibibyteRate} loading={history.loading} error={history.error} onRetry={retry} />
                <HistoryChart title="流量进出这台服务器" description={`接收 / 发送 · 主机网卡 · ${period}`} source="PROMETHEUS / POSTGRESQL" intervalSeconds={history.data?.intervalSeconds} points={history.data?.points} series={NETWORK_SERIES} unit="KiB/s" format={kibibyteRate} loading={history.loading} error={history.error} onRetry={retry} />
              </div><p className={styles.methodNote}>读数时间为北京时间。主机保留最近七天，兼容切换前的 PostgreSQL 历史；HTTP 信号从入口采集启用后开始记录。延迟分位数基于 5 分钟窗口，请求速率与错误率基于 1 分钟窗口。</p>
            </>}
            {selection.view === "infrastructure" && <>
              <div className={styles.infrastructureIntro}><span className={styles.sectionNumber}>RUNTIME INVENTORY / 运行清单</span><h2>每一种“正常”，都有自己的口径。</h2><p>HTTP 检查验证响应，进程检查验证运行，TCP 检查验证端口可达。认证重定向表示入口可达，不等同于应用功能验证。</p></div>
              {current.loading && !sample ? <div className={styles.pageLoading} role="status"><LoaderCircle size={18} className={styles.spin} />正在读取基础设施…</div> : <>
                {["http", "process", "tcp"].map((kind) => <section className={styles.serviceSection} key={kind}><div className={styles.sectionHeader}><h2>{{ http: "HTTP 检查", process: "进程运行", tcp: "端口可达" }[kind]}</h2><span>{{ http: "验证响应状态与探测耗时", process: "仅表示进程或数据库探针运行", tcp: "仅表示服务器本机可建立连接" }[kind]}</span></div><div className={styles.serviceRows}>{services.filter((service) => service.kind === kind).length ? services.filter((service) => service.kind === kind).map((service) => <article className={styles.serviceRow} key={service.id}><div><h3>{service.name}</h3><p>{checksFresh.stale ? "检查样本已过期，当前状态未知。" : service.detail || service.kindLabel}</p></div><div className={styles.serviceReadings}>{service.httpStatus !== null && service.httpStatus !== undefined && <span className={styles.code}>HTTP {service.httpStatus}</span>}<span className={styles.latency}>{finite(service.latencyMs) ? `${numberLabel(service.latencyMs, 0)} ms` : "—"}</span><span className={styles.badge} data-status={service.status}>{service.status === "healthy" && <Check size={12} aria-hidden="true" />}{service.label}</span></div></article>) : <p className={styles.emptyRows}>暂无这一类检查样本。</p>}</div></section>)}
                <section className={styles.containers}><div className={styles.sectionHeader}><h2>Docker 容器</h2><span>资源每 15 秒更新 · CPU 100% = 1 个逻辑核 · 缺失值为 —</span></div><div className={styles.containerGrid}>{containers.length ? containers.map((container) => <article className={styles.containerCard} key={container.name}><div className={styles.containerTitle}><h3>{container.name}</h3><span className={styles.badge} data-status={container.stateStatus} title={`原始状态：${container.state || "—"}`}>{container.stateLabel}</span></div><p className={styles.imageVersion} title={container.image || ""}>{container.image || "版本未知"}</p><dl className={styles.containerFacts}><div><dt>CPU 占用</dt><dd>{checksFresh.stale ? "—" : numberLabel(container.cpuPercent)}{!checksFresh.stale && finite(container.cpuPercent) ? "%" : ""}</dd></div><div><dt>内存占用</dt><dd>{checksFresh.stale ? "—" : bytesLabel(container.memoryBytes)}</dd></div><div><dt>内存 / 限额</dt><dd>{checksFresh.stale ? "—" : `${numberLabel(container.memoryPercent)}${finite(container.memoryPercent) ? "%" : ""} / ${bytesLabel(container.memoryLimitBytes)}`}</dd></div><div><dt>重启次数</dt><dd>{checksFresh.stale ? "—" : numberLabel(container.restartCount, 0)}</dd></div><div><dt>Docker 健康状态</dt><dd>{container.healthLabel}</dd></div></dl></article>) : <p className={styles.emptyRows}>暂无容器样本。</p>}</div></section>
              </>}
            </>}
          </div>
        </>}
      </main>
      <footer className={styles.footer}><Link href="/" className={styles.homeLink}><ArrowLeft size={14} aria-hidden="true" />返回个人网站</Link><span>真实采样 · Prometheus · 最近七天</span><span>单主机 / 本机检查视角</span></footer>
    </div>
  </div>;
}
