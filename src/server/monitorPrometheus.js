import http from "node:http";
import { buildMonitorHistoryPoints, MONITOR_HISTORY_RANGES, MONITOR_HOST_ID, MONITOR_RETENTION_MS } from "./monitorValidation.js";
import { readStandardMonitorChecks, STANDARD_MONITOR_METRICS } from "./monitorStandardChecks.js";

const PREFIX = "server_monitor_";
const HOST_FIELDS = Object.freeze({
  "cpu.percent": "host_cpu_percent", "cpu.load1": "host_load1", "cpu.load5": "host_load5", "cpu.load15": "host_load15", "cpu.cores": "host_cpu_cores",
  "memory.totalBytes": "host_memory_total_bytes", "memory.availableBytes": "host_memory_available_bytes", "memory.usedBytes": "host_memory_used_bytes", "memory.usedPercent": "host_memory_used_percent",
  "swap.totalBytes": "host_swap_total_bytes", "swap.usedBytes": "host_swap_used_bytes", "swap.usedPercent": "host_swap_used_percent",
  "disk.totalBytes": "host_disk_total_bytes", "disk.usedBytes": "host_disk_used_bytes", "disk.availableBytes": "host_disk_available_bytes", "disk.usedPercent": "host_disk_used_percent",
  "disk.readBytesPerSecond": "host_disk_read_bytes_per_second", "disk.writeBytesPerSecond": "host_disk_write_bytes_per_second",
  "network.rxBytesPerSecond": "host_network_rx_bytes_per_second", "network.txBytesPerSecond": "host_network_tx_bytes_per_second", uptimeSeconds: "host_uptime_seconds",
});
export const PROMETHEUS_HISTORY_FIELDS = Object.freeze({
  cpuPercent: "host_cpu_percent", memoryPercent: "host_memory_used_percent", swapPercent: "host_swap_used_percent", diskPercent: "host_disk_used_percent",
  diskReadBytesPerSecond: "host_disk_read_bytes_per_second", diskWriteBytesPerSecond: "host_disk_write_bytes_per_second",
  rxBytesPerSecond: "host_network_rx_bytes_per_second", txBytesPerSecond: "host_network_tx_bytes_per_second",
});
const CONTAINER_FIELDS = Object.freeze({ restartCount: "restart_count", cpuPercent: "cpu_percent", memoryBytes: "memory_bytes", memoryLimitBytes: "memory_limit_bytes", memoryPercent: "memory_percent" });
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const agent = new http.Agent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 2, timeout: 10_000 });
const selector = (name) => `${PREFIX}${name}{host_id="${MONITOR_HOST_ID}"}`;

export function prometheusSettings(env = process.env) {
  const url = new URL(env.MONITOR_PROMETHEUS_URL?.trim() || "http://127.0.0.1:19090");
  // Only operator-configured numeric private addresses are accepted. No DNS,
  // credentials, redirects, inherited HTTP proxy, or request-supplied target.
  const octets = url.hostname.split(".").map(Number);
  const numeric = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const privateAddress = numeric && (url.hostname === "127.0.0.1" || octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
  if (url.protocol !== "http:" || !privateAddress || !["19090", "19091", "19094", "19095"].includes(url.port) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("invalid_monitor_prometheus_url");
  return { origin: url.origin };
}

export function monitorExporterMode(env = process.env) {
  const mode = env.MONITOR_EXPORTER_MODE?.trim() || "legacy";
  if (!["legacy", "standard"].includes(mode)) throw new Error("invalid_monitor_exporter_mode");
  return mode;
}

function requestPrometheus(settings, path, params, signal) {
  const url = new URL(path, settings.origin);
  url.search = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const request = http.get(url, { agent, signal, headers: { Accept: "application/json" } }, (response) => {
      if (response.statusCode !== 200) { response.destroy(); reject(new Error("prometheus_unavailable")); return; }
      if (Number(response.headers["content-length"]) > MAX_RESPONSE_BYTES) { response.destroy(); reject(new Error("prometheus_response_too_large")); return; }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { response.destroy(new Error("prometheus_response_too_large")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (payload.status !== "success" || !payload.data || !Array.isArray(payload.data.result) || payload.data.result.length > 512) throw new Error("invalid_prometheus_response");
          resolve(payload.data);
        } catch { reject(new Error("invalid_prometheus_response")); }
      });
    });
    request.on("error", reject);
  });
}

function context(options, history = false) {
  const settings = prometheusSettings(options.env);
  // Leave a network margin inside the dashboard's 12 s request deadline.
  // Historical raw-window aggregation needs more time once all 7 days exist.
  const signal = options.signal || AbortSignal.timeout(history ? 10_000 : 6500);
  const request = options.request || requestPrometheus;
  return async (path, params) => {
    const data = await request(settings, path, { ...params, timeout: history ? "8s" : "5s" }, signal);
    if (!data || !Array.isArray(data.result) || data.result.length > 512) throw new Error("invalid_prometheus_response");
    return data;
  };
}

function value(number, max = Number.MAX_SAFE_INTEGER) {
  if ((typeof number !== "string" && typeof number !== "number") || number === "") return null;
  const parsed = Number(number);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

function text(input, length = 128, nullable = false) {
  if (typeof input !== "string" || input.length > length || /[\u0000-\u001f\u007f]/.test(input)) return nullable ? null : "未知";
  if (/(bearer\s+\S+|-----begin|(?:password|passwd|secret|token|credential|api[_-]?key)\s*[:=]|:\/\/[^\s/]+:[^\s/]+@)/i.test(input)) return "[redacted]";
  return nullable && !input ? null : input;
}

function groupMetric(name, group) {
  return group === "host" ? name.startsWith(PREFIX + "host_") : /^server_monitor_(checks_|container_|service_)/.test(name);
}

function scrapeFrames(data, groups = ["host", "checks"]) {
  if (data.resultType !== "matrix") throw new Error("invalid_prometheus_response");
  const series = data.result.filter((entry) => entry?.metric?.host_id === MONITOR_HOST_ID && typeof entry.metric.__name__ === "string" && entry.metric.__name__.startsWith(PREFIX));
  for (const entry of series) {
    if (!Array.isArray(entry.values) || entry.values.length > 64 || entry.values.some((pair) => !Array.isArray(pair) || pair.length !== 2 || !Number.isFinite(Number(pair[0])))) throw new Error("invalid_prometheus_response");
  }
  const entries = [];
  for (const group of groups) {
    const captures = series.filter((entry) => entry.metric.__name__ === `${PREFIX}${group}_collected_at_seconds` && entry.values.length);
    // More than one capture series means multiple targets claim this host;
    // never silently choose a different exporter or merge two scrape batches.
    if (captures.length > 1) throw new Error("ambiguous_prometheus_series");
    if (!captures.length) continue;
    const frame = Math.max(...captures[0].values.map((pair) => Math.round(Number(pair[0]) * 1000)));
    for (const entry of series.filter((item) => groupMetric(item.metric.__name__, group))) {
      const pairs = entry.values.filter((pair) => Math.round(Number(pair[0]) * 1000) === frame);
      if (pairs.length > 1) throw new Error("ambiguous_prometheus_series");
      if (pairs.length) entries.push({ metric: entry.metric, value: pairs[0] });
    }
  }
  return entries;
}

function one(entries, name, labels = {}) {
  const matches = entries.filter((entry) => entry.metric.__name__ === PREFIX + name && Object.entries(labels).every(([key, expected]) => entry.metric[key] === expected));
  if (matches.length > 1) throw new Error("ambiguous_prometheus_series");
  return matches[0];
}

function captured(entries, group, now) {
  const seconds = value(one(entries, `${group}_collected_at_seconds`)?.value?.[1]);
  return seconds !== null && seconds * 1000 >= now - MONITOR_RETENTION_MS && seconds * 1000 <= now + 60_000 ? Math.round(seconds * 1000) : null;
}

function info(entries, name, identity, max) {
  const matches = entries.filter((entry) => entry.metric.__name__ === PREFIX + name && value(entry.value[1]) === 1);
  if (matches.length > max || (identity && new Set(matches.map((entry) => entry.metric[identity])).size !== matches.length) || (!identity && matches.length > 1)) throw new Error("ambiguous_prometheus_series");
  return matches.map((entry) => entry.metric);
}

function numeric(entries, name, labels = {}, max) { return value(one(entries, name, labels)?.value?.[1], max); }

// Prometheus can retain an old info label for its 5 minute lookback after a
// restart because its scrape cache no longer knows to mark that label stale.
// A raw range selector exposes actual sample times: select only metrics from
// the exact host/check capture-gauge scrape frame, including null omissions.
// Older snapshots use the same atomic selection and keep their true age.
async function restoreMissingSnapshots(entries, now, query, groups = ["host", "checks"]) {
  const missing = groups.filter((group) => captured(entries, group, now) === null);
  if (!missing.length) return entries;
  const discovery = missing.map((group) => `label_replace(last_over_time(${selector(`${group}_collected_at_seconds`)}[7d]),"monitor_group","${group}","","")`).join(" or ");
  const found = await query("/api/v1/query", { query: discovery, time: String(now / 1000) });
  if (found.resultType !== "vector") throw new Error("invalid_prometheus_response");
  const restored = await Promise.all(missing.map(async (group) => {
    const candidates = found.result.filter((entry) => entry?.metric?.host_id === MONITOR_HOST_ID && entry.metric.monitor_group === group);
    if (candidates.length > 1) throw new Error("ambiguous_prometheus_series");
    const seconds = value(candidates[0]?.value?.[1]);
    if (seconds === null || seconds * 1000 < now - MONITOR_RETENTION_MS || seconds * 1000 > now + 60_000) return [];
    const pattern = group === "host" ? "server_monitor_host_.+" : "server_monitor_(checks_.+|container_.+|service_.+)";
    // Host aliases are recorded up to one evaluation interval after the raw
    // node sample. Include that bounded lag, but never substitute a different
    // capture or advance its age to the recording evaluation timestamp.
    const through = Math.min(now / 1000, seconds + 10);
    const restored = scrapeFrames(await query("/api/v1/query", { query: `{__name__=~"${pattern}",host_id="${MONITOR_HOST_ID}"}[60s]`, time: String(through) }), [group]);
    return captured(restored, group, now) === Math.round(seconds * 1000) ? restored : [];
  }));
  return [...entries.filter((entry) => !missing.some((group) => group === "host" ? entry.metric.__name__.startsWith(PREFIX + "host_") : /^server_monitor_(checks_|container_|service_)/.test(entry.metric.__name__))), ...restored.flat()];
}

export async function readPrometheusCurrent(now = Date.now(), options = {}) {
  const query = context(options), standard = monitorExporterMode(options.env) === "standard", groups = standard ? ["host"] : ["host", "checks"];
  const names = standard ? `server_monitor_host_.+|${STANDARD_MONITOR_METRICS}` : "server_monitor_.+";
  const raw = await query("/api/v1/query", { query: `{__name__=~"${names}",host_id="${MONITOR_HOST_ID}"}[60s]`, time: String(now / 1000) });
  const entries = await restoreMissingSnapshots(scrapeFrames(raw, groups), now, query, groups);
  const hostTime = captured(entries, "host", now), checksTime = captured(entries, "checks", now);
  let sample = null, standardChecks = null;
  if (hostTime !== null) {
    const metadata = info(entries, "host_info", null, 1)[0] || {};
    const host = { hostname: text(metadata.hostname), cpu: {}, memory: {}, swap: {}, disk: { mount: text(metadata.mount) }, network: { interface: text(metadata.interface, 64, true) } };
    for (const [path, metric] of Object.entries(HOST_FIELDS)) {
      const parts = path.split(".");
      const number = numeric(entries, metric, {}, /(?:percent|Percent)$/.test(path) ? 100 : undefined);
      if (parts.length === 1) host[path] = number;
      else host[parts[0]][parts[1]] = number;
    }
    const containers = checksTime === null ? [] : info(entries, "container_info", "name", 100).map((item) => ({
      name: text(item.name), image: text(item.image, 256, true), state: text(item.state, 32), health: text(item.health, 32, true),
      ...Object.fromEntries(Object.entries(CONTAINER_FIELDS).map(([field, metric]) => [field, numeric(entries, `container_${metric}`, { name: item.name }, field === "memoryPercent" ? 100 : undefined)])),
    }));
    const services = checksTime === null ? [] : info(entries, "service_info", "id", 30).map((item) => ({
      id: text(item.id, 64), name: text(item.name), kind: ["http", "process", "tcp"].includes(item.kind) ? item.kind : "http",
      status: ["healthy", "unhealthy", "reachable", "unknown"].includes(item.status) ? item.status : "unknown",
      detail: text(item.detail, 240, true), latencyMs: numeric(entries, "service_latency_ms", { id: item.id }, 60_000), httpStatus: numeric(entries, "service_http_status", { id: item.id }, 599),
    }));
    sample = { hostId: MONITOR_HOST_ID, collectedAt: new Date(hostTime).toISOString(), host,
      checksCollectedAt: checksTime === null ? null : new Date(checksTime).toISOString(), containers, services };
    if (standard) {
      standardChecks = readStandardMonitorChecks(raw, now, host.memory.totalBytes);
      sample = { ...sample, containers: standardChecks.containers, services: standardChecks.services, checksCollectedAt: standardChecks.checksCollectedAt };
    }
  }
  if (standard && !standardChecks) standardChecks = readStandardMonitorChecks(raw, now);
  return { sample, stale: hostTime === null || now - hostTime > 45_000,
    checksStale: standard ? standardChecks.checksStale : checksTime === null || now - checksTime > 45_000, serverTime: new Date(now).toISOString() };
}

function aggregateQuery(durationMs) {
  return Object.entries(PROMETHEUS_HISTORY_FIELDS).flatMap(([field, name]) => [
    `label_replace(label_replace(avg_over_time(${selector(name)}[${durationMs}ms]),"monitor_field","${field}","",""),"monitor_stat","mean","","")`,
    `label_replace(label_replace(count_over_time(${selector(name)}[${durationMs}ms]),"monitor_field","${field}","",""),"monitor_stat","count","","")`,
  ]).join(" or ");
}

export async function readPrometheusHistoryRows(range, now = Date.now(), options = {}) {
  const definition = MONITOR_HISTORY_RANGES[range];
  if (!definition) throw new Error("invalid_range");
  const query = context(options, true), stepMs = definition.intervalSeconds * 1000;
  const end = Math.floor(now / stepMs) * stepMs, start = end - definition.durationSeconds * 1000;
  const lower = Math.max(start, options.after ?? start), rows = new Map();
  if (lower > now) return [];
  function consume(data, bucketForTime, expectedType) {
    if (data.resultType !== expectedType) throw new Error("invalid_prometheus_response");
    const seen = new Set();
    for (const entry of data.result) {
      const field = entry?.metric?.monitor_field, stat = entry?.metric?.monitor_stat;
      if (entry?.metric?.host_id !== MONITOR_HOST_ID || !Object.hasOwn(PROMETHEUS_HISTORY_FIELDS, field) || !["mean", "count"].includes(stat)) continue;
      if (seen.has(`${field}:${stat}`)) throw new Error("ambiguous_prometheus_series");
      seen.add(`${field}:${stat}`);
      const pairs = expectedType === "matrix" ? entry.values : [entry.value];
      if (!Array.isArray(pairs) || pairs.length > 1201) throw new Error("invalid_prometheus_response");
      for (const pair of pairs) {
        if (!Array.isArray(pair) || pair.length !== 2 || !Number.isFinite(Number(pair[0]))) throw new Error("invalid_prometheus_response");
        const bucket = bucketForTime(Math.round(Number(pair[0]) * 1000));
        if (bucket < start || bucket > end || bucket % stepMs !== 0) throw new Error("invalid_prometheus_response");
        const row = rows.get(bucket) || { collectedAt: new Date(bucket).toISOString() };
        row[stat === "count" ? `${field}Count` : field] = value(pair[1], stat === "mean" && /Percent$/.test(field) ? 100 : undefined);
        rows.set(bucket, row);
      }
    }
  }
  const jobs = [];
  const fullStart = Math.ceil(lower / stepMs) * stepMs, fullEnd = end - stepMs;
  if (fullStart <= fullEnd) {
    jobs.push(query("/api/v1/query_range", { query: aggregateQuery(stepMs), start: String((fullStart + stepMs - 1) / 1000), end: String((fullEnd + stepMs - 1) / 1000), step: String(definition.intervalSeconds) })
      .then((data) => consume(data, (time) => time - stepMs + 1, "matrix")));
  }
  const partials = new Map();
  if (lower % stepMs !== 0) partials.set(Math.floor(lower / stepMs) * stepMs, lower);
  partials.set(end, Math.max(end, lower));
  for (const [bucket, from] of partials) {
    if (from > now) continue;
    const through = Math.min(now, bucket + stepMs - 1);
    jobs.push(query("/api/v1/query", { query: aggregateQuery(through - from + 1), time: String(through / 1000) })
      .then((data) => consume(data, () => bucket, "vector")));
  }
  await Promise.all(jobs);
  return [...rows.values()].sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt));
}

export function mergeMonitorHistoryRows(legacy, prometheus, range, now = Date.now()) {
  const rows = new Map();
  for (const source of [legacy, prometheus]) for (const row of source) {
    const time = new Date(row.collectedAt).getTime();
    const merged = rows.get(time) || { collectedAt: new Date(time).toISOString() };
    for (const field of Object.keys(PROMETHEUS_HISTORY_FIELDS)) {
      const mean = value(row[field]), count = value(row[`${field}Count`]);
      if (mean === null || count === null || count <= 0) continue;
      const previousCount = merged[`${field}Count`] || 0;
      merged[field] = ((merged[field] || 0) * previousCount + mean * count) / (previousCount + count);
      merged[`${field}Count`] = previousCount + count;
    }
    rows.set(time, merged);
  }
  return buildMonitorHistoryPoints([...rows.values()], range, now);
}

export async function readPrometheusHistory(range, now = Date.now(), options = {}) {
  return mergeMonitorHistoryRows([], await readPrometheusHistoryRows(range, now, options), range, now);
}
