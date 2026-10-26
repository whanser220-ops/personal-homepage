export const MONITOR_GRAFANA_VIEWS = Object.freeze([
  { id: "overview", uid: "monitor-sre-overview", label: "运行概览", title: "运行概览", description: "先看当前状态，再定位需要关注的服务。", refresh: "3s" },
  { id: "trends", uid: "monitor-sre-trends", label: "信号趋势", title: "信号趋势", description: "沿着时间观察延迟、流量、错误与资源压力，缺失采样保留断点。", refresh: "30s" },
  { id: "infrastructure", uid: "monitor-sre-infrastructure", label: "基础设施", title: "基础设施", description: "检查容器、采集组件与服务器的运行细节。", refresh: "30s" },
]);
export const MONITOR_GRAFANA_RANGES = Object.freeze([
  { id: "1h", label: "1 小时" }, { id: "24h", label: "24 小时" }, { id: "7d", label: "7 天" },
]);

const LEGACY_VIEWS = Object.freeze({ "monitor-overview": "overview", "monitor-history": "trends", "monitor-services": "overview", "monitor-containers": "infrastructure" });
const viewId = (value) => MONITOR_GRAFANA_VIEWS.some((view) => view.id === value) ? value : "overview";
const rangeId = (value) => MONITOR_GRAFANA_RANGES.some((range) => range.id === value) ? value : "1h";

export function parseMonitorGrafanaHash(hash = "") {
  const [name, query = ""] = hash.replace(/^#/, "").split("?", 2);
  return { view: viewId(LEGACY_VIEWS[name] || name), range: rangeId(new URLSearchParams(query).get("range")) };
}

export function monitorGrafanaHash(view, range) {
  return `#${viewId(view)}?range=${rangeId(range)}`;
}

export function monitorGrafanaUrl(view, range, theme, embedded = true) {
  const board = MONITOR_GRAFANA_VIEWS.find((item) => item.id === viewId(view));
  const query = new URLSearchParams({ orgId: "1", from: `now-${rangeId(range)}`, to: "now", refresh: board.refresh, theme: theme === "light" ? "light" : "dark" });
  query.set("var-resolution", ({ "1h": "3s", "24h": "5m", "7d": "30m" })[rangeId(range)]);
  if (embedded) query.set("kiosk", "tv");
  return `/server-monitor/grafana/d/${board.uid}/${board.id}?${query}`;
}

// Elapsed bootstrap time is a progress hint, never evidence of a failed
// request. A late load can still complete after a cold asset download.
export function monitorGrafanaLoadTransition(previous, event) {
  if (event === "start") return "loading";
  if (event === "slow") return previous === "loading" ? "slow" : previous;
  if (event === "loaded") return "ready";
  if (event === "failed") return "error";
  return previous;
}
