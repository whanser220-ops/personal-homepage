import { readCurrentMonitorSample as readLegacyCurrent, readMonitorHistory as readLegacyHistory, readMonitorHistoryRows } from "./monitorDb.js";
import { mergeMonitorHistoryRows, readPrometheusCurrent, readPrometheusHistoryRows } from "./monitorPrometheus.js";
import { MONITOR_HISTORY_RANGES } from "./monitorValidation.js";

export function monitorDataBackend(env = process.env) {
  const backend = env.MONITOR_DATA_BACKEND?.trim() || "postgres";
  if (!["postgres", "prometheus"].includes(backend)) throw new Error("invalid_monitor_data_backend");
  return backend;
}

export function monitorCutover(env = process.env) {
  const input = env.MONITOR_PROMETHEUS_CUTOVER_AT?.trim();
  const cutoff = Date.parse(input);
  if (!input || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input) || !Number.isFinite(cutoff) || new Date(cutoff).toISOString().slice(0, 19) !== input.slice(0, 19)) throw new Error("invalid_monitor_prometheus_cutover");
  return cutoff;
}

export async function readCurrentMonitorSample(now = Date.now()) {
  // Never hide a Prometheus failure by substituting old PostgreSQL current
  // data. Google sessions still use PostgreSQL through monitorAuth.
  return monitorDataBackend() === "prometheus" ? readPrometheusCurrent(now) : readLegacyCurrent(now);
}

export async function readMonitorHistory(range, now = Date.now()) {
  if (monitorDataBackend() !== "prometheus") return readLegacyHistory(range, now);
  const definition = MONITOR_HISTORY_RANGES[range];
  if (!definition) throw new Error("invalid_range");
  const cutoff = monitorCutover();
  const start = Math.floor(now / (definition.intervalSeconds * 1000)) * definition.intervalSeconds * 1000 - definition.durationSeconds * 1000;
  const [legacy, prometheus] = await Promise.all([
    cutoff > start ? readMonitorHistoryRows(range, now, { before: cutoff }) : [],
    readPrometheusHistoryRows(range, now, { after: cutoff }),
  ]);
  return mergeMonitorHistoryRows(legacy, prometheus, range, now);
}
