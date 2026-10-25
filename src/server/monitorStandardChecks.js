import { MONITOR_HOST_ID } from "./monitorValidation.js";

const CUSTOM_JOB = "server-monitor-custom", CADVISOR_JOB = "server-monitor-cadvisor", BLACKBOX_JOB = "server-monitor-blackbox";
const CONTAINERS = ["personal-homepage", "learning-whiteboard", "personal-homepage-postgres"];
const PROCESSES = [
  ["study-agent", "Study Agent 进程"], ["study-agent-remote", "远程运行进程"],
  ["nginx", "Nginx 进程"], ["docker", "Docker 进程"], ["postgres", "PostgreSQL"],
];
const PROBES = [
  ["website", "个人网站", "http"], ["whiteboard", "学习白板", "http"], ["jenkins", "Jenkins", "http"],
  ["study-agent-http", "Study Agent HTTP", "http"], ["remote-run-port", "远程运行端口", "tcp"], ["perforce", "Perforce", "tcp"],
];
export const STANDARD_MONITOR_METRICS = "up|server_monitor_custom_.+|container_(cpu_usage_seconds_total|memory_working_set_bytes|spec_memory_limit_bytes|last_seen)|probe_(success|http_status_code|duration_seconds)";

function number(input, max = Number.MAX_SAFE_INTEGER) {
  if ((typeof input !== "number" && typeof input !== "string") || input === "") return null;
  const result = Number(input);
  return Number.isFinite(result) && result >= 0 && result <= max ? result : null;
}

function label(input, max = 128, nullable = false) {
  if (typeof input !== "string" || input.length > max || /[\u0000-\u001f\u007f]/.test(input)) return nullable ? null : "未知";
  if (/(bearer\s+\S+|-----begin|(?:password|passwd|secret|token|credential|api[_-]?key)\s*[:=]|:\/\/[^\s/]+:[^\s/]+@)/i.test(input)) return "[redacted]";
  return nullable && !input ? null : input;
}

const time = (pair) => Math.round(Number(pair[0]) * 1000);
const isId = (input) => typeof input === "string" && /^[0-9a-f]{64}$/.test(input);
function containerId(labels) {
  if (isId(labels.container_id)) return labels.container_id;
  return /(?:^|\/)(?:docker-)?([0-9a-f]{64})(?:\.scope)?$/.exec(labels.id || "")?.[1] || null;
}

function selected(rows, name, frame, predicate = () => true) {
  const matches = [];
  if (frame === null) return matches;
  for (const row of rows.filter((item) => item.metric.__name__ === name && predicate(item.metric))) {
    const pairs = row.values.filter((pair) => time(pair) === frame);
    if (pairs.length > 1) throw new Error("ambiguous_prometheus_series");
    if (pairs.length) matches.push({ labels: row.metric, value: number(pairs[0][1], name === "container_spec_memory_limit_bytes" ? Number.MAX_VALUE : undefined) });
  }
  return matches;
}

function single(rows, name, frame, predicate, max) {
  const matches = selected(rows, name, frame, predicate);
  if (matches.length > 1) throw new Error("ambiguous_prometheus_series");
  return number(matches[0]?.value, max);
}

function source(rows, job, id) {
  const own = rows.filter((row) => row.metric.job === job && (id === undefined || row.metric.id === id));
  const markers = own.filter((row) => row.metric.__name__ === "up" && row.values.length);
  if (markers.length > 1) throw new Error("ambiguous_prometheus_series");
  const attempts = markers[0]?.values.map((pair) => ({ frame: time(pair), success: number(pair[1]) === 1 })).sort((a, b) => a.frame - b.frame) || [];
  if (new Set(attempts.map((attempt) => attempt.frame)).size !== attempts.length) throw new Error("ambiguous_prometheus_series");
  const latest = attempts.at(-1), successful = attempts.filter((attempt) => attempt.success);
  return { rows: own, attempts, successful, frame: latest?.success ? latest.frame : null,
    lastSuccess: successful.at(-1)?.frame ?? null };
}

function capture(value, now) {
  const seconds = number(value);
  return seconds !== null && seconds * 1000 >= now - 7 * 86400_000 && seconds * 1000 <= now + 60_000 ? Math.round(seconds * 1000) : null;
}

function cpuCounter(rows, frame, identity) {
  let matches = selected(rows, "container_cpu_usage_seconds_total", frame, (labels) => containerId(labels) === identity);
  const total = matches.filter((item) => !item.labels.cpu || item.labels.cpu === "total");
  if (total.length > 1) throw new Error("ambiguous_prometheus_series");
  if (total.length) matches = total;
  if (!matches.length || matches.some((item) => item.value === null)) return null;
  if (new Set(matches.map((item) => item.labels.cpu)).size !== matches.length) throw new Error("ambiguous_prometheus_series");
  return matches.reduce((sum, item) => sum + item.value, 0);
}

function seenTime(source, frame, identity, now) {
  return capture(single(source.rows, "container_last_seen", frame, (labels) => containerId(labels) === identity), now);
}

function cpuPercent(source, identity, now) {
  const current = cpuCounter(source.rows, source.frame, identity);
  if (current === null || source.frame === null) return null;
  const previous = source.successful.filter((item) => item.frame < source.frame).at(-1);
  if (!previous || seenTime(source, source.frame, identity, now) === null || seenTime(source, previous.frame, identity, now) === null) return null;
  const interval = source.attempts.filter((attempt) => attempt.frame >= previous.frame && attempt.frame <= source.frame);
  if (interval.some((attempt) => !attempt.success) || source.frame - previous.frame > 22_500) return null;
  const before = cpuCounter(source.rows, previous.frame, identity);
  if (before === null || current < before) return null; // First frame or counter reset is unknown, never zero.
  // cAdvisor last_seen is the exporter's whole-second observation clock, not
  // the stats housekeeping timestamp. Use the two actual Prometheus scrape
  // times, as for a counter rate; the 15 s housekeeping cache can affect it.
  return number((current - before) / ((source.frame - previous.frame) / 1000) * 100);
}

function probeService(source, [id, name, kind]) {
  const base = { id, name, kind, status: "unknown", latencyMs: null, httpStatus: null, detail: "探测采集端未提供当前数据" };
  if (source.frame === null) return base;
  const success = single(source.rows, "probe_success", source.frame, undefined, 1);
  const seconds = single(source.rows, "probe_duration_seconds", source.frame);
  base.latencyMs = seconds === null ? null : number(seconds * 1000, 60_000);
  if (kind === "tcp") return { ...base, status: success === 1 ? "reachable" : success === 0 ? "unhealthy" : "unknown",
    detail: success === 1 ? "服务器本机 TCP 端口可达；仅验证连接" : success === 0 ? "服务器本机 TCP 连接失败或超时" : base.detail };
  const code = single(source.rows, "probe_http_status_code", source.frame, undefined, 599);
  base.httpStatus = code !== null && Number.isInteger(code) && code >= 100 ? code : null;
  if (base.httpStatus !== null && code >= 200 && code < 300) return { ...base, status: "healthy", detail: `HTTP ${code}；服务器本机视角` };
  if (base.httpStatus !== null && ((code >= 300 && code < 400) || code === 401 || code === 403)) return { ...base, status: "reachable", detail: `HTTP ${code}；认证或重定向入口可达` };
  return { ...base, status: base.httpStatus !== null || success === 0 ? "unhealthy" : "unknown",
    detail: base.httpStatus !== null ? `HTTP ${code}；服务器本机视角` : success === 0 ? "服务器本机 HTTP 请求失败或超时" : base.detail };
}

export function readStandardMonitorChecks(data, now = Date.now(), hostMemoryBytes = null) {
  if (data?.resultType !== "matrix" || !Array.isArray(data.result)) throw new Error("invalid_prometheus_response");
  const rows = data.result.filter((row) => row?.metric?.host_id === MONITOR_HOST_ID && [CUSTOM_JOB, CADVISOR_JOB, BLACKBOX_JOB].includes(row.metric.job));
  for (const row of rows) {
    if (!Array.isArray(row.values) || row.values.length > 64 || row.values.some((pair) => !Array.isArray(pair) || pair.length !== 2 || !Number.isFinite(Number(pair[0])))) throw new Error("invalid_prometheus_response");
  }
  const custom = source(rows, CUSTOM_JOB), cadvisor = source(rows, CADVISOR_JOB);
  const probes = PROBES.map((definition) => ({ definition, source: source(rows, BLACKBOX_JOB, definition[0]) }));
  const customTime = capture(single(custom.rows, "server_monitor_custom_collected_at_seconds", custom.frame ?? custom.lastSuccess), now);
  const captured = [customTime, cadvisor.lastSuccess, ...probes.map((probe) => probe.source.lastSuccess)];
  const containers = CONTAINERS.map((name) => {
    const metadata = selected(custom.rows, "server_monitor_custom_container_info", custom.frame, (labels) => labels.name === name);
    if (metadata.length > 1) throw new Error("ambiguous_prometheus_series");
    const labels = metadata[0]?.value === 1 ? metadata[0].labels : {}, identity = isId(labels.container_id) ? labels.container_id : null;
    const restart = single(custom.rows, "server_monitor_custom_container_restart_count", custom.frame, (item) => item.name === name && item.container_id === labels.container_id);
    const result = { name, image: label(labels.image, 256, true), state: label(labels.state, 32), health: label(labels.health, 32, true),
      restartCount: restart !== null && Number.isInteger(restart) ? restart : null, cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, memoryPercent: null };
    if (!identity || labels.state !== "running" || cadvisor.frame === null) return result;
    const seen = seenTime(cadvisor, cadvisor.frame, identity, now);
    captured.push(seen);
    if (seen === null || now - seen > 45_000) return result;
    const memory = single(cadvisor.rows, "container_memory_working_set_bytes", cadvisor.frame, (item) => containerId(item) === identity);
    const limit = single(cadvisor.rows, "container_spec_memory_limit_bytes", cadvisor.frame, (item) => containerId(item) === identity, Number.MAX_VALUE);
    // cAdvisor encodes an unlimited cgroup as zero (specMemoryValue). Match
    // Docker stats' effective limit: the smaller configured limit/host RAM.
    const boundedLimit = limit !== null && hostMemoryBytes > 0 ? (limit === 0 ? hostMemoryBytes : Math.min(limit, hostMemoryBytes)) : limit === 0 ? null : number(limit);
    return { ...result, cpuPercent: cpuPercent(cadvisor, identity, now), memoryBytes: memory, memoryLimitBytes: boundedLimit,
      memoryPercent: memory !== null && boundedLimit > 0 ? number(memory / boundedLimit * 100, 100) : null };
  });
  const processes = PROCESSES.map(([id, name]) => {
    const matches = selected(custom.rows, "server_monitor_custom_service_info", custom.frame, (labels) => labels.id === id);
    if (matches.length > 1) throw new Error("ambiguous_prometheus_series");
    const item = matches[0]?.value === 1 ? matches[0].labels : {};
    return { id, name, kind: "process", status: ["healthy", "unhealthy", "unknown"].includes(item.status) ? item.status : "unknown",
      latencyMs: null, httpStatus: null, detail: label(item.detail, 240, true) || "进程采集端未提供当前数据" };
  });
  const known = captured.filter((item) => item !== null && item !== undefined);
  const oldest = known.length ? Math.min(...known) : null;
  return { containers, services: [...probes.map((probe) => probeService(probe.source, probe.definition)), ...processes],
    checksCollectedAt: oldest === null ? null : new Date(oldest).toISOString(),
    checksStale: known.length !== captured.length || oldest === null || now - oldest > 45_000 };
}
