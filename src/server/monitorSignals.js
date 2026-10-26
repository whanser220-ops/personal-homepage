import { monitorPrometheusQuery } from "./monitorPrometheus.js";
import { MONITOR_HISTORY_RANGES, MONITOR_HOST_ID, MONITOR_RETENTION_MS } from "./monitorValidation.js";

export const MONITOR_SIGNAL_SERVICES = Object.freeze(["all", "website", "whiteboard", "study-agent"]);
export const MONITOR_SIGNAL_FIELDS = Object.freeze([
  "requestsPerSecond", "serverErrorPercent", "clientErrorPercent", "successP95Ms", "successP99Ms",
  "failureP95Ms", "failureP99Ms", "responseBytesPerSecond",
]);
const FRESH_SECONDS = 9, REQUEST_WINDOW = 60, LATENCY_WINDOW = 300;
const marker = `server_monitor_http_recorded_at_seconds{host_id="${MONITOR_HOST_ID}"}`;
const source = `up{job="server-monitor-http",host_id="${MONITOR_HOST_ID}"}`;
const sourceFields = ["captureSeconds", "recordedSeconds", "exporterValue", "exporterSeconds", "parseErrorsTotal", "exporterSeries", "markerSeries"];
const emptyMetrics = () => Object.fromEntries(MONITOR_SIGNAL_FIELDS.map((field) => [field, null]));

export function validMonitorSignalService(service) {
  return typeof service === "string" && MONITOR_SIGNAL_SERVICES.includes(service);
}

function selectService(service) {
  if (!validMonitorSignalService(service)) throw new Error("invalid_service");
  return service === "all" ? 'service=~"website|whiteboard|study-agent"' : `service="${service}"`;
}

function frame(name, selection, status = "") {
  const metric = `${name}{${selection}${status ? `,status=~"${status}"` : ""}}`;
  // Preserve both clocks: marker VALUE is the real scrape; marker TIMESTAMP
  // is the final recording rule's raw frame. Filter before every aggregation.
  return `(${metric} and (timestamp(${metric}) == scalar(max(timestamp(${marker}))))`
    + ` and on () (max(${marker}) > time() - ${FRESH_SECONDS})`
    + ` and on () (max(timestamp(${marker})) > time() - ${FRESH_SECONDS})`
    + ` and on () (max(${source}) == 1) and on () (max(timestamp(${source})) > time() - ${FRESH_SECONDS}))`;
}

export function monitorSignalsQuery(service = "all", includeSource = false) {
  const selection = selectService(service);
  const total = `sum(${frame("server_monitor:http_requests:rate1m", selection)})`;
  const errorPercent = (status) => `100 * (sum(${frame("server_monitor:http_requests:rate1m", selection, status)}) or (${total} * 0)) / (${total} > 0)`;
  const quantile = (failure, percentile) => `1000 * histogram_quantile(${percentile}, sum by (le) (${frame(
    failure ? "server_monitor:http_server_error_duration_seconds_bucket:rate5m" : "server_monitor:http_success_duration_seconds_bucket:rate5m", selection)}))`;
  const fields = {
    requestsPerSecond: total, serverErrorPercent: errorPercent("5.."), clientErrorPercent: errorPercent("4.."),
    successP95Ms: quantile(false, 0.95), successP99Ms: quantile(false, 0.99),
    failureP95Ms: quantile(true, 0.95), failureP99Ms: quantile(true, 0.99),
    responseBytesPerSecond: `sum(${frame("server_monitor:http_response_bytes:rate1m", selection)})`,
  };
  if (includeSource) {
    const parsing = `server_monitor_http_parse_errors_total{job="server-monitor-http",host_id="${MONITOR_HOST_ID}"}`;
    Object.assign(fields, {
      captureSeconds: `max(${marker})`, recordedSeconds: `max(timestamp(${marker}))`,
      exporterValue: `max(${source})`, exporterSeconds: `max(timestamp(${source}))`,
      exporterSeries: `count(${source})`, markerSeries: `count(${marker})`,
      parseErrorsTotal: `max(${parsing} and (timestamp(${parsing}) == on (host_id) group_left max by (host_id) (timestamp(${source})))`
        + ` and on (host_id) (${source} == 1) and on (host_id) (timestamp(${source}) > time() - ${FRESH_SECONDS}))`,
    });
  }
  return Object.entries(fields).map(([field, expression]) => `label_replace((${expression}),"monitor_field","${field}","","")`).join(" or ");
}

function numeric(input, max = Number.MAX_SAFE_INTEGER) {
  if ((typeof input !== "number" && typeof input !== "string") || input === "") return null;
  const number = Number(input);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}

function pair(input) {
  if (!Array.isArray(input) || input.length !== 2 || !Number.isFinite(Number(input[0]))) throw new Error("invalid_prometheus_response");
  return [Math.round(Number(input[0]) * 1000), input[1]];
}

function metricValue(field, input) {
  return numeric(input, /ErrorPercent$/.test(field) ? 100 : undefined);
}

function capture(input, now) {
  const number = numeric(input);
  return number !== null && number * 1000 >= now - MONITOR_RETENTION_MS && number * 1000 <= now + 1000 ? Math.round(number * 1000) : null;
}

function normalizeMetrics(values) {
  const metrics = { ...emptyMetrics(), ...values };
  if (metrics.requestsPerSecond === null || metrics.requestsPerSecond === 0) {
    metrics.serverErrorPercent = null;
    metrics.clientErrorPercent = null;
  }
  return metrics;
}

export async function readPrometheusSignalsCurrent(service = "all", now = Date.now(), options = {}) {
  const expression = monitorSignalsQuery(service, true), query = monitorPrometheusQuery(options);
  const data = await query("/api/v1/query", { query: expression, time: String(now / 1000) });
  if (data.resultType !== "vector") throw new Error("invalid_prometheus_response");
  const values = {}, seen = new Set();
  for (const entry of data.result) {
    const field = entry?.metric?.monitor_field;
    if (![...MONITOR_SIGNAL_FIELDS, ...sourceFields].includes(field)) continue;
    if (seen.has(field)) throw new Error("ambiguous_prometheus_series");
    seen.add(field);
    values[field] = metricValue(field, pair(entry.value)[1]);
  }
  if (values.exporterSeries > 1 || values.markerSeries > 1) throw new Error("ambiguous_prometheus_series");
  const collected = capture(values.captureSeconds, now), recorded = capture(values.recordedSeconds, now);
  const sourceTime = capture(values.exporterSeconds, now);
  const exporterUp = [0, 1].includes(values.exporterValue) ? values.exporterValue === 1 : null;
  const stale = exporterUp !== true || collected === null || recorded === null || sourceTime === null
    || [collected, recorded, sourceTime].some((time) => now - time >= FRESH_SECONDS * 1000);
  const metrics = stale ? emptyMetrics() : normalizeMetrics(Object.fromEntries(MONITOR_SIGNAL_FIELDS.map((field) => [field, values[field] ?? null])));
  return { service, serverTime: new Date(now).toISOString(), collectedAt: collected === null ? null : new Date(collected).toISOString(),
    recordedAt: recorded === null ? null : new Date(recorded).toISOString(), staleAfterSeconds: FRESH_SECONDS, stale, exporterUp,
    parseErrorsTotal: values.parseErrorsTotal ?? null,
    trafficState: stale ? "unavailable" : metrics.requestsPerSecond === null ? "no_data" : metrics.requestsPerSecond === 0 ? "no_traffic" : "observed",
    requestWindowSeconds: REQUEST_WINDOW, latencyWindowSeconds: LATENCY_WINDOW, metrics };
}

export async function readPrometheusSignalsHistory(service, range, now = Date.now(), options = {}) {
  if (typeof range !== "string" || !Object.hasOwn(MONITOR_HISTORY_RANGES, range)) throw new Error("invalid_range");
  const definition = MONITOR_HISTORY_RANGES[range];
  const expression = monitorSignalsQuery(service), query = monitorPrometheusQuery(options, true);
  const step = definition.intervalSeconds * 1000;
  const end = Math.floor(now / step) * step, start = end - definition.durationSeconds * 1000;
  const data = await query("/api/v1/query_range", { query: expression, start: String(start / 1000), end: String(end / 1000), step: String(definition.intervalSeconds) });
  if (data.resultType !== "matrix") throw new Error("invalid_prometheus_response");
  const rows = new Map(), seen = new Set();
  for (const entry of data.result) {
    const field = entry?.metric?.monitor_field;
    if (!MONITOR_SIGNAL_FIELDS.includes(field)) continue;
    if (seen.has(field)) throw new Error("ambiguous_prometheus_series");
    seen.add(field);
    if (!Array.isArray(entry.values) || entry.values.length > 1201) throw new Error("invalid_prometheus_response");
    const times = new Set();
    for (const input of entry.values) {
      const [time, value] = pair(input);
      if (time < start || time > end || time % step !== 0 || times.has(time)) throw new Error("invalid_prometheus_response");
      times.add(time);
      const row = rows.get(time) || emptyMetrics();
      row[field] = metricValue(field, value);
      rows.set(time, row);
    }
  }
  const points = [];
  for (let time = start; time <= end; time += step) points.push({ collectedAt: new Date(time).toISOString(), ...normalizeMetrics(rows.get(time) || emptyMetrics()) });
  return { service, range, intervalSeconds: definition.intervalSeconds, requestWindowSeconds: REQUEST_WINDOW, latencyWindowSeconds: LATENCY_WINDOW, points };
}
