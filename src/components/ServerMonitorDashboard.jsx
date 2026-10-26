"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, ArrowUpRight, ChartNoAxesCombined, Check, ChevronLeft, CircleAlert, LoaderCircle, LockKeyhole, LogOut, Moon, RefreshCw, Server, ShieldCheck, Sun } from "lucide-react";
import { MONITOR_GRAFANA_RANGES, MONITOR_GRAFANA_VIEWS, monitorGrafanaHash, monitorGrafanaLoadTransition, monitorGrafanaUrl, parseMonitorGrafanaHash } from "./monitorGrafanaView.js";
import styles from "./ServerMonitorDashboard.module.css";

const ICONS = { overview: Activity, trends: ChartNoAxesCombined, infrastructure: Server };
const VIEW_STORAGE = "server-monitor-grafana-view";
const THEME_STORAGE = "server-monitor-grafana-theme";
async function request(url, signal, options = {}) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal, ...options });
  if (!response.ok) {
    const error = new Error(response.status === 401 ? "登录已过期，请重新登录。" : `服务暂时不可用（HTTP ${response.status}），请稍后重试。`);
    error.status = response.status;
    throw error;
  }
  return response;
}
const requestJson = async (url, signal, options) => (await request(url, signal, options)).json();
function timeLabel(value) {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "等待采样";
}
function freshness(value, expired, now) {
  const timestamp = Date.parse(value), age = Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp) / 1000)) : null;
  return { age, stale: expired || age === null || age > 45, text: age === null ? "等待采样" : age > 45 || expired ? "数据已过期" : `${age} 秒前更新` };
}

export function ServerMonitorDashboard() {
  const [session, setSession] = useState(null), [sessionError, setSessionError] = useState(""), [sessionAttempt, setSessionAttempt] = useState(0);
  const [loginError, setLoginError] = useState(""), [logoutError, setLogoutError] = useState(""), [loggingOut, setLoggingOut] = useState(false);
  const [selection, setSelection] = useState({ view: "overview", range: "1h" }), [theme, setTheme] = useState("dark");
  const [current, setCurrent] = useState(null), [currentError, setCurrentError] = useState(""), [currentAttempt, setCurrentAttempt] = useState(0);
  const [now, setNow] = useState(0), [clockOffset, setClockOffset] = useState(0);
  const [frameAllowed, setFrameAllowed] = useState(false), [accessAttempt, setAccessAttempt] = useState(0), [frameVersion, setFrameVersion] = useState(0);
  const [frameState, setFrameState] = useState("checking"), [frameError, setFrameError] = useState("");
  const epoch = useRef(0), currentAbort = useRef(null), accessAbort = useRef(null), frame = useRef(null), frameTimer = useRef(null), tabs = useRef([]);
  const board = MONITOR_GRAFANA_VIEWS.find((item) => item.id === selection.view);
  const frameUrl = useMemo(() => monitorGrafanaUrl(selection.view, selection.range, theme), [selection, theme]);
  const fullUrl = useMemo(() => monitorGrafanaUrl(selection.view, selection.range, theme, false), [selection, theme]);

  useEffect(() => {
    const syncSelection = () => setSelection(parseMonitorGrafanaHash(window.location.hash));
    let remembered = "";
    try { remembered = sessionStorage.getItem(VIEW_STORAGE) || ""; } catch {}
    try { setTheme(localStorage.getItem(THEME_STORAGE) === "light" ? "light" : "dark"); } catch {}
    setSelection(parseMonitorGrafanaHash(window.location.hash || remembered));
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason) setLoginError(["access_denied", "forbidden"].includes(reason) ? "这个 Google 账号没有访问权限，请使用已授权的账号。" : "Google 登录未完成，请重新登录。");
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("hashchange", syncSelection);
    window.addEventListener("popstate", syncSelection);
    return () => { clearInterval(timer); window.removeEventListener("hashchange", syncSelection); window.removeEventListener("popstate", syncSelection); };
  }, []);

  useEffect(() => {
    const controller = new AbortController(); let stopped = false;
    const timer = setTimeout(() => controller.abort(), 12000);
    setSessionError("");
    requestJson("/api/monitor/auth/session", controller.signal).then((value) => {
      if (!stopped) { setSession(value); if (value.authenticated) setLoginError(""); }
    }).catch((error) => { if (!stopped) setSessionError(error.name === "AbortError" ? "登录状态读取超时，请重试。" : error.message); }).finally(() => clearTimeout(timer));
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [sessionAttempt]);

  const clearPrivateState = useCallback((message = "") => {
    epoch.current++;
    currentAbort.current?.abort(); accessAbort.current?.abort();
    setFrameAllowed(false); setCurrent(null); setCurrentError(""); setFrameError(""); setFrameState("checking");
    setSession((previous) => ({ authenticated: false, configured: previous?.configured }));
    setLoginError(message);
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    const controller = new AbortController(), generation = epoch.current; let stopped = false;
    accessAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 10000);
    setFrameAllowed(false); setFrameState("checking"); setFrameError("");
    request("/api/monitor/auth/grafana", controller.signal).then((response) => {
      if (response.status !== 204) throw new Error("看板权限校验未完成，请重试。");
      if (!stopped && generation === epoch.current) { setFrameAllowed(true); setFrameState("loading"); }
    }).catch((error) => {
      if (stopped || generation !== epoch.current) return;
      if (error.status === 401) clearPrivateState(error.message);
      else { setFrameError(error.name === "AbortError" ? "看板权限校验超时，请重试。" : error.message); setFrameState("error"); }
    }).finally(() => clearTimeout(timer));
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [session?.authenticated, accessAttempt, clearPrivateState]);

  useEffect(() => {
    if (!session?.authenticated) return;
    let stopped = false, busy = false, controller, timer;
    const generation = epoch.current;
    async function load() {
      if (busy || stopped || generation !== epoch.current || document.visibilityState === "hidden") return;
      busy = true; controller = new AbortController(); currentAbort.current = controller;
      timer = setTimeout(() => controller.abort(), 10000);
      try {
        const value = await requestJson("/api/monitor/current", controller.signal), received = Date.now();
        if (stopped || generation !== epoch.current) return;
        const serverTime = Date.parse(value.serverTime);
        if (Number.isFinite(serverTime)) setClockOffset(serverTime - received);
        setCurrent(value); setCurrentError("");
      } catch (error) {
        if (stopped || generation !== epoch.current) return;
        if (error.status === 401) clearPrivateState(error.message);
        else setCurrentError(error.name === "AbortError" ? "采集状态读取超时，稍后自动重试。" : error.message);
      } finally { clearTimeout(timer); busy = false; }
    }
    load(); const interval = setInterval(load, 3000);
    document.addEventListener("visibilitychange", load);
    return () => { stopped = true; clearInterval(interval); clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", load); };
  }, [session?.authenticated, currentAttempt, clearPrivateState]);

  useEffect(() => {
    if (!frameAllowed || !session?.authenticated || loggingOut) return;
    setFrameState((previous) => monitorGrafanaLoadTransition(previous, "start")); setFrameError("");
    frameTimer.current = setTimeout(() => {
      setFrameState((previous) => monitorGrafanaLoadTransition(previous, "slow"));
    }, 20000);
    return () => clearTimeout(frameTimer.current);
  }, [frameAllowed, frameUrl, frameVersion, session?.authenticated, loggingOut]);

  function rememberSelection(value = selection) {
    try { sessionStorage.setItem(VIEW_STORAGE, monitorGrafanaHash(value.view, value.range)); } catch {}
  }
  function navigate(view, range = selection.range) {
    const next = { view, range };
    setSelection(next); rememberSelection(next);
    window.history.pushState(null, "", monitorGrafanaHash(view, range));
  }
  function tabKey(event, index) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? MONITOR_GRAFANA_VIEWS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + MONITOR_GRAFANA_VIEWS.length) % MONITOR_GRAFANA_VIEWS.length;
    navigate(MONITOR_GRAFANA_VIEWS[next].id); tabs.current[next]?.focus();
  }
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_STORAGE, next); } catch {}
  }
  function refresh() {
    setCurrentAttempt((value) => value + 1);
    // The proxy still checks the existing Google session on every Grafana
    // request. Re-authorizing here would remove an already allowed frame and
    // add a second serial round trip before an explicit document reload.
    if (frameAllowed) setFrameVersion((value) => value + 1);
    else setAccessAttempt((value) => value + 1);
  }
  async function frameLoaded() {
    const generation = epoch.current;
    try {
      const document = frame.current?.contentDocument, location = frame.current?.contentWindow?.location;
      if (!document || location?.href === "about:blank") return;
      clearTimeout(frameTimer.current);
      if (!location?.pathname.startsWith("/server-monitor/grafana/")) {
        // Nginx can send an expired HTML navigation back to this login shell.
        // Verify the database session before choosing a retry or login state.
        await request("/api/monitor/auth/grafana", AbortSignal.timeout(8000));
        throw new Error("看板入口暂时不可用，请重新载入。");
      }
      const failedTitle = /bad gateway|service unavailable|gateway timeout|not found|^error|^[45]\d\d/i.test(document.title);
      const failedBody = /Grafana has failed to load|Dashboard not found|Permission denied|^\s*Unauthorized\s*$/i.test(document.body?.textContent?.slice(0, 800) || "");
      if (failedTitle || failedBody) throw new Error("看板暂时不可用，请重新载入。");
      if (generation === epoch.current) setFrameState((previous) => monitorGrafanaLoadTransition(previous, "loaded"));
    } catch (error) {
      if (generation !== epoch.current) return;
      if (error.status === 401) clearPrivateState(error.message);
      else { setFrameState((previous) => monitorGrafanaLoadTransition(previous, "failed")); setFrameError(error.name === "SecurityError" ? "看板连接未完成，请重新载入。" : error.message || "看板加载失败，请重试。"); }
    }
  }
  async function logout() {
    setLoggingOut(true); setLogoutError("");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try { await requestJson("/api/monitor/auth/logout", controller.signal, { method: "POST" }); clearPrivateState(); }
    catch { setLogoutError("退出失败，请重试。"); }
    finally { clearTimeout(timer); setLoggingOut(false); }
  }

  const sample = current?.sample, hostFreshness = freshness(sample?.collectedAt, current?.stale, now + clockOffset);
  const checksFreshness = freshness(sample?.checksCollectedAt, current?.checksStale, now + clockOffset);
  const authPending = !session && !sessionError;
  return <div className={styles.page} data-theme={theme}>
    <div className={styles.backdrop} aria-hidden="true" />
    <div className={styles.wrap}>
      <a className={styles.skip} href="#monitor-main">跳到监控看板</a>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="返回 Huang 首页"><span className={styles.brandMark}><Activity size={21} aria-hidden="true" /></span><span><strong>Huang</strong><small>服务监控</small></span></Link>
        <div className={styles.topActions}>
          {session?.authenticated && <span className={styles.identity} title={session.email}><ShieldCheck size={13} aria-hidden="true" />{session.email}</span>}
          <button className={styles.iconButton} type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "切换浅色外观" : "切换深色外观"} title={theme === "dark" ? "切换浅色外观" : "切换深色外观"}>{theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}</button>
          {session?.authenticated && <><button className={styles.iconButton} type="button" onClick={refresh} disabled={loggingOut} aria-label="重新载入当前看板" title="重新载入当前看板"><RefreshCw size={16} aria-hidden="true" /></button><button className={styles.iconButton} type="button" onClick={logout} disabled={loggingOut} aria-label={loggingOut ? "正在退出监控" : "退出监控"} title="退出监控">{loggingOut ? <LoaderCircle size={17} className={styles.spin} aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}</button></>}
        </div>
      </header>
      <main id="monitor-main">
        <section className={styles.heading} aria-labelledby="monitor-title">
          <div><p className={styles.eyebrow}><span />PRIVATE OBSERVABILITY</p><h1 id="monitor-title">{session?.authenticated ? board.title : "让服务器的状态，清晰可见。"}</h1><p className={styles.description}>{session?.authenticated ? board.description : "运行状态、资源趋势与基础设施，集中在一个私有看板。"}</p></div>
          <span className={styles.scope}><Server size={14} aria-hidden="true" />服务器本机视角</span>
        </section>

        {!session?.authenticated ? <section className={styles.loginPanel} aria-labelledby="monitor-login-title">
          <div className={styles.loginCopy}><span className={styles.lockMark}><LockKeyhole size={27} aria-hidden="true" /></span><p className={styles.eyebrow}>YOUR PRIVATE WORKSPACE</p><h2 id="monitor-login-title">一台服务器。<br />一个专注的观察窗口。</h2><p>登录后进入完整的 Grafana 看板，查看服务状态、资源变化和运行细节。</p><div className={styles.loginFacts}><span>主机 3 秒</span><span>服务 15 秒</span><span>7 天历史</span></div></div>
          <div className={styles.loginAction}><ShieldCheck size={27} aria-hidden="true" /><h3>{authPending ? "正在确认访问权限" : "登录私有看板"}</h3><p>使用已授权的 Google 账号继续。</p>{loginError && <p className={styles.formError} role="alert">{loginError}</p>}
            {sessionError ? <><p className={styles.formError} role="alert">{sessionError}</p><button className={styles.primaryButton} type="button" onClick={() => setSessionAttempt((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" />重新确认登录状态</button></> : authPending ? <p className={styles.loadingLabel} role="status"><LoaderCircle size={18} className={styles.spin} aria-hidden="true" />读取登录状态…</p> : session?.configured ? <a className={styles.primaryButton} href="/api/monitor/auth/google/start" onClick={() => rememberSelection()}>使用 Google 登录<ArrowRight size={16} aria-hidden="true" /></a> : <p className={styles.formError}>Google 登录尚未配置，暂时无法访问看板。</p>}
            <small>身份验证通过后才加载监控内容。</small>
          </div>
        </section> : <>
          {logoutError && <p className={styles.errorBanner} role="alert"><CircleAlert size={16} aria-hidden="true" />{logoutError}</p>}
          {currentError && <p className={styles.errorBanner} role="alert"><CircleAlert size={16} aria-hidden="true" />{currentError}<button type="button" onClick={() => setCurrentAttempt((value) => value + 1)}>重试</button></p>}
          <div className={styles.freshnessStrip}>
            <div><span className={styles.statusDot} data-state={!sample ? "unknown" : hostFreshness.stale ? "stale" : "fresh"} /><span>主机采样</span><strong>{hostFreshness.text}</strong><time dateTime={sample?.collectedAt || undefined} title="北京时间">{sample ? timeLabel(sample.collectedAt) : "—"}</time></div>
            <div><span className={styles.statusDot} data-state={checksFreshness.age === null ? "unknown" : checksFreshness.stale ? "stale" : "fresh"} /><span>服务检查</span><strong>{checksFreshness.text}</strong><time dateTime={sample?.checksCollectedAt || undefined} title="北京时间">{timeLabel(sample?.checksCollectedAt)}</time></div>
            <span className={styles.sr} role="status">{!sample ? "等待主机采样" : hostFreshness.stale ? "主机数据已过期" : "主机采样正常"}。{checksFreshness.stale ? "服务检查数据已过期" : "服务检查采样正常"}。</span>
            <p>采集 <b>3 秒 / 15 秒</b><span> · </span>历史刷新 <b>30 秒</b></p>
          </div>
          <section className={styles.workspace} aria-label="Grafana 服务监控">
            <div className={styles.toolbar}>
              <div className={styles.tabs} role="tablist" aria-label="监控看板">{MONITOR_GRAFANA_VIEWS.map((item, index) => { const Icon = ICONS[item.id]; return <button key={item.id} ref={(element) => { tabs.current[index] = element; }} id={`monitor-tab-${item.id}`} type="button" role="tab" aria-selected={selection.view === item.id} aria-controls="monitor-grafana-panel" tabIndex={selection.view === item.id ? 0 : -1} onClick={() => navigate(item.id)} onKeyDown={(event) => tabKey(event, index)}><Icon size={16} aria-hidden="true" />{item.label}</button>; })}</div>
              <div className={styles.boardControls}><div className={styles.ranges} role="group" aria-label="看板时间范围">{MONITOR_GRAFANA_RANGES.map((item) => <button key={item.id} type="button" aria-pressed={selection.range === item.id} onClick={() => navigate(selection.view, item.id)}>{item.label}</button>)}</div><a className={styles.openButton} href={fullUrl} target="_blank" rel="noopener noreferrer" aria-label="在新标签中打开完整 Grafana 看板" title="在新标签中打开"><ArrowUpRight size={18} aria-hidden="true" /></a></div>
            </div>
            <div className={styles.boardMeta}><span><span className={styles.grafanaDot} />GRAFANA<span className={styles.boardMetaSeparator}>/</span>{board.label}</span><span>{board.refresh === "3s" ? "实时数值 · 3 秒刷新" : "趋势与诊断 · 30 秒刷新"}</span></div>
            {frameAllowed && !loggingOut && (frameState === "loading" || frameState === "slow") && <div className={styles.frameLoadNotice} role="status"><LoaderCircle size={14} className={styles.spin} aria-hidden="true" /><span>{frameState === "slow" ? "看板仍在加载，请继续等待，无需反复刷新。" : "正在载入看板…"}</span><a href={fullUrl} target="_blank" rel="noopener noreferrer">新标签打开<ArrowUpRight size={13} aria-hidden="true" /></a></div>}
            <div id="monitor-grafana-panel" className={styles.framePanel} role="tabpanel" aria-labelledby={`monitor-tab-${selection.view}`} aria-busy={frameState === "checking" || frameState === "loading" || frameState === "slow" || loggingOut}>
              {frameAllowed && !loggingOut && <iframe key={frameVersion} ref={frame} className={styles.frame} data-view={selection.view} title={`${board.label} · Grafana 服务器监控`} src={frameUrl} loading="eager" referrerPolicy="same-origin" allowFullScreen onLoad={frameLoaded} onError={() => { clearTimeout(frameTimer.current); setFrameState((previous) => monitorGrafanaLoadTransition(previous, "failed")); setFrameError("看板连接失败，请重新载入。"); }} />}
              {(!frameAllowed || frameState === "checking" || frameState === "error" || loggingOut) && <div className={styles.frameOverlay}>
                {frameState === "error" ? <div className={styles.frameMessage} role="alert"><CircleAlert size={28} aria-hidden="true" /><h2>看板暂时未能打开</h2><p>{frameError || "请重新载入，或在新标签中打开看板。"}</p><div><button className={styles.primaryButton} type="button" onClick={refresh}><RefreshCw size={15} aria-hidden="true" />重新载入</button><a className={styles.secondaryButton} href={fullUrl} target="_blank" rel="noopener noreferrer">新标签打开<ArrowUpRight size={15} aria-hidden="true" /></a></div></div> : <div className={styles.frameMessage} role="status"><LoaderCircle size={27} className={styles.spin} aria-hidden="true" /><h2>{loggingOut ? "正在退出监控" : frameState === "checking" ? "正在校验看板访问权限" : "正在打开看板"}</h2><p>{loggingOut ? "正在结束当前登录会话。" : "完整监控视图即将呈现。"}</p></div>}
              </div>}
            </div>
          </section>
        </>}
      </main>
      <footer className={styles.footer}><Link href="/" className={styles.homeLink}><ChevronLeft size={14} aria-hidden="true" />返回个人网站</Link><span><Check size={12} aria-hidden="true" />Google 私有访问<span className={styles.footerSeparator}>·</span>Prometheus + Grafana</span><span>本机检查视角 · 缺失采样保留断点</span></footer>
    </div>
  </div>;
}
