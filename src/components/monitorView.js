export const MONITOR_VIEWS = Object.freeze([
  { id: "overview", label: "运行概览", number: "01", description: "此刻的流量、资源与运行状态。" },
  { id: "trends", label: "信号趋势", number: "02", description: "观察变化，保留每一处采样断点。" },
  { id: "infrastructure", label: "基础设施", number: "03", description: "分清 HTTP、进程与端口，检查容器的运行细节。" },
]);
export const MONITOR_RANGES = Object.freeze([{ id: "1h", label: "1 小时" }, { id: "24h", label: "24 小时" }, { id: "7d", label: "7 天" }]);
export const MONITOR_SERVICES = Object.freeze([{ id: "all", label: "全部应用" }, { id: "website", label: "个人网站" }, { id: "whiteboard", label: "学习白板" }, { id: "study-agent", label: "Study Agent" }]);
const legacy = { "monitor-overview": "overview", "monitor-history": "trends", "monitor-services": "infrastructure", "monitor-containers": "infrastructure" };
export function parseMonitorView(hash = "") {
  const [name, query = ""] = hash.replace(/^#/, "").split("?", 2), params = new URLSearchParams(query);
  return { view: MONITOR_VIEWS.find((item) => item.id === (legacy[name] || name))?.id || "overview", range: MONITOR_RANGES.find((item) => item.id === params.get("range"))?.id || "1h", service: MONITOR_SERVICES.find((item) => item.id === params.get("service"))?.id || "all" };
}
export function monitorViewHash(value) {
  const safe = parseMonitorView(`#${value.view}?range=${value.range}&service=${value.service}`);
  return `#${safe.view}?range=${safe.range}&service=${safe.service}`;
}
export const finite = (value) => typeof value === "number" && Number.isFinite(value);
export function numberLabel(value, digits = 1) { return finite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—"; }
export function bytesLabel(value, rate = false) {
  if (!finite(value)) return "—";
  const unit = ["B", "KiB", "MiB", "GiB", "TiB"], power = value > 0 ? Math.min(4, Math.max(0, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
  return `${numberLabel(value / 1024 ** power, power === 0 ? 0 : 1)} ${unit[power]}${rate ? "/s" : ""}`;
}
export function uptimeLabel(value) {
  if (!finite(value)) return "—";
  const days = Math.floor(value / 86400), hours = Math.floor(value % 86400 / 3600), minutes = Math.floor(value % 3600 / 60);
  return days ? `${days} 天 ${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}
export function historyResolution(value) {
  if (!finite(value) || value <= 0) return null;
  return value % 3600 === 0 ? `${value / 3600} 小时/点` : value % 60 === 0 ? `${value / 60} 分钟/点` : `${value} 秒/点`;
}
export function monitorTime(value, withDate = false, withSeconds = !withDate) {
  const time = new Date(value);
  return value && Number.isFinite(time.getTime()) ? time.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", ...(withDate ? { month: "2-digit", day: "2-digit" } : {}), hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}), hour12: false }) : "—";
}
export function monitorFreshness(collectedAt, now, forced = false, maxAge = 45, inclusive = false) {
  const time = Date.parse(collectedAt), elapsed = Number.isFinite(time) && finite(now) ? Math.max(0, now - time) : null;
  const age = elapsed === null ? null : Math.floor(elapsed / 1000), stale = Boolean(forced) || elapsed === null || (inclusive ? elapsed >= maxAge * 1000 : elapsed > maxAge * 1000);
  return { age, stale, text: age === null ? "等待采样" : stale ? "数据已过期" : `${age} 秒前更新` };
}
export function effectiveService(service, stale) {
  const status = stale ? "unknown" : service.status;
  return { ...service, status, label: ({ healthy: "检查正常", reachable: "可达", unhealthy: "检查失败", unknown: "未知" })[status] || "未知", kindLabel: ({ http: "HTTP 检查", process: "进程运行", tcp: "端口可达" })[service.kind] || "未知检查" };
}
export function effectiveContainer(container, stale) {
  const states = { running: "运行中", created: "已创建", paused: "已暂停", restarting: "重启中", removing: "移除中", exited: "已退出", dead: "已停止" };
  const stateKnown = Object.hasOwn(states, container.state);
  return { ...container, stateStatus: stale || !stateKnown ? "unknown" : container.state === "running" ? "healthy" : "unhealthy",
    stateLabel: stale || !stateKnown ? "未知" : states[container.state],
    healthLabel: stale ? "未知" : ({ none: "未配置健康检查", healthy: "健康", unhealthy: "不健康", starting: "启动检查中", unknown: "未知" })[container.health] || "未知" };
}
export const SIGNAL_METRICS = Object.freeze([
  { id: "requestsPerSecond", label: "请求流量", unit: "请求 / 秒", digits: 2, note: "最近 1 分钟平均" },
  { id: "serverErrorPercent", label: "服务端错误", unit: "%", digits: 2, note: "5xx · 最近 1 分钟" },
  { id: "successP95Ms", label: "成功请求 P95", unit: "ms", digits: 1, note: "成功请求 · 最近 5 分钟" },
  { id: "successP99Ms", label: "成功请求 P99", unit: "ms", digits: 1, note: "成功请求 · 最近 5 分钟" },
  { id: "failureP95Ms", label: "失败请求 P95", unit: "ms", digits: 1, note: "失败请求 · 最近 5 分钟" },
  { id: "failureP99Ms", label: "失败请求 P99", unit: "ms", digits: 1, note: "失败请求 · 最近 5 分钟" },
  { id: "clientErrorPercent", label: "客户端错误", unit: "%", digits: 2, note: "4xx · 最近 1 分钟" },
  { id: "responseBytesPerSecond", label: "响应流量", unit: "B/s", digits: 0, note: "最近 1 分钟平均" },
]);
export function signalMessage(signals, stale) {
  if (!signals || stale) return "HTTP 数据源未更新；不据此判断应用健康。";
  if (signals.trafficState === "no_traffic") return "最近 1 分钟没有请求；错误率不适用，5 分钟延迟仍可能有值。";
  if (signals.trafficState === "no_data") return "尚无请求样本；等待真实访问。";
  if (signals.trafficState === "unavailable") return "HTTP 数据暂不可用；请查看服务检查。";
  return "基于服务器入口请求；错误率与请求延迟按各自窗口统计。";
}

// F2/F3 adapters retain each observation and split at missing samples. The
// equal-time barcode floor is a time ruler, never a replacement for data.
export function chartGeometry(points, keys, options = {}) {
  const width = options.width || 640, height = options.height || 240;
  const left = 48, right = width - 18, top = 22, base = height - 36;
  const times = points.map((point) => Date.parse(point.collectedAt));
  const validTimes = times.filter(Number.isFinite), start = validTimes[0], end = validTimes.at(-1);
  const values = points.flatMap((point, index) => Number.isFinite(times[index]) ? keys.map((key) => point[key]).filter(finite) : []);
  const observedMax = values.length ? Math.max(...values) : 0, max = finite(options.max) ? options.max : observedMax > 0 ? observedMax * 1.12 : 1;
  const x = (time) => left + (end > start ? (time - start) / (end - start) : 0.5) * (right - left);
  const y = (value) => base - Math.max(0, value) / max * (base - top);
  const series = keys.map((key) => {
    const segments = []; let segment = [];
    points.forEach((point, index) => {
      if (!Number.isFinite(times[index]) || !finite(point[key])) { if (segment.length) segments.push(segment); segment = []; return; }
      segment.push({ x: x(times[index]), y: y(point[key]), value: point[key], time: times[index], index });
    });
    if (segment.length) segments.push(segment);
    return { key, segments, path: segments.map((part) => part.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")).join(" ") };
  });
  return { width, height, left, right, top, base, start, end, max, series, x, y, hasData: values.length > 0, valuesCount: values.length };
}
