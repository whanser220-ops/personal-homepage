import assert from "node:assert/strict";
import test from "node:test";
import { MONITOR_SIGNAL_FIELDS, monitorSignalsQuery, readPrometheusSignalsCurrent, readPrometheusSignalsHistory } from "../src/server/monitorSignals.js";

const NOW = Date.parse("2026-10-26T06:00:01.234Z");
const env = { MONITOR_PROMETHEUS_URL: "http://172.30.0.1:19091" };
const row = (field, value, at = NOW) => ({ metric: { monitor_field: field }, value: [at / 1000, String(value)] });
const vector = (result) => ({ resultType: "vector", result });
const matrix = (result) => ({ resultType: "matrix", result });
function snapshot(values = {}) {
  return Object.entries({ captureSeconds: (NOW - 1500) / 1000, recordedSeconds: (NOW - 1000) / 1000,
    exporterValue: 1, exporterSeconds: (NOW - 1800) / 1000, exporterSeries: 1, markerSeries: 1, parseErrorsTotal: 0,
    requestsPerSecond: 10, serverErrorPercent: 10, clientErrorPercent: 5, successP95Ms: 95, successP99Ms: 99,
    failureP95Ms: 950, failureP99Ms: 990, responseBytesPerSecond: 500, ...values }).map(([field, value]) => row(field, value));
}
const fixed = (result) => ({ env, request: async () => result });

test("current signals retain actual source and recording clocks rather than vector evaluation time", async () => {
  let calls = 0;
  const result = await readPrometheusSignalsCurrent("all", NOW, { env, request: async (_settings, path, params, signal) => {
    calls++;
    assert.equal(path, "/api/v1/query");
    assert.equal(params.timeout, "5s");
    assert.equal(Number(params.time), NOW / 1000);
    assert.equal(signal.aborted, false);
    return vector(snapshot());
  } });
  assert.equal(calls, 1);
  assert.equal(result.collectedAt, new Date(NOW - 1500).toISOString());
  assert.equal(result.recordedAt, new Date(NOW - 1000).toISOString());
  assert.equal(result.stale, false);
  assert.equal(result.exporterUp, true);
  assert.equal(result.trafficState, "observed");
  assert.equal(result.staleAfterSeconds, 9);
  assert.equal(result.requestWindowSeconds, 60);
  assert.equal(result.latencyWindowSeconds, 300);
  assert.equal(result.metrics.requestsPerSecond, 10);
  assert.equal(result.metrics.failureP99Ms, 990);
});

test("no observed requests and an observed zero rate are distinct, with no healthy zero error fraction", async () => {
  const metadata = snapshot().filter((entry) => !MONITOR_SIGNAL_FIELDS.includes(entry.metric.monitor_field));
  const absent = await readPrometheusSignalsCurrent("website", NOW, fixed(vector(metadata)));
  assert.equal(absent.stale, false);
  assert.equal(absent.trafficState, "no_data");
  assert.ok(Object.values(absent.metrics).every((value) => value === null));
  const quiet = await readPrometheusSignalsCurrent("website", NOW, fixed(vector(snapshot({ requestsPerSecond: 0, serverErrorPercent: 0, clientErrorPercent: 0 }))));
  assert.equal(quiet.trafficState, "no_traffic");
  assert.equal(quiet.metrics.requestsPerSecond, 0);
  assert.equal(quiet.metrics.serverErrorPercent, null);
  assert.equal(quiet.metrics.clientErrorPercent, null);
  assert.equal(quiet.metrics.successP95Ms, 95, "the 5 minute latency window can still contain observations");
});

test("source, recording, and exporter freshness independently suppress all current metric values", async () => {
  for (const fields of [{ captureSeconds: (NOW - 9000) / 1000 }, { captureSeconds: (NOW - 9001) / 1000 }, { recordedSeconds: (NOW - 9001) / 1000 },
    { exporterSeconds: (NOW - 9001) / 1000 }, { exporterValue: 0 }, { captureSeconds: (NOW + 2000) / 1000 }]) {
    const result = await readPrometheusSignalsCurrent("all", NOW, fixed(vector(snapshot(fields))));
    assert.equal(result.stale, true);
    assert.equal(result.trafficState, "unavailable");
    assert.ok(Object.values(result.metrics).every((value) => value === null));
  }
});

test("nonfinite, negative and invalid percentages remain null while parse failures stay visible", async () => {
  const result = await readPrometheusSignalsCurrent("study-agent", NOW, fixed(vector(snapshot({ successP95Ms: "NaN",
    failureP95Ms: "+Inf", failureP99Ms: -1, serverErrorPercent: 101, responseBytesPerSecond: 0, parseErrorsTotal: 2 }))));
  assert.equal(result.metrics.successP95Ms, null);
  assert.equal(result.metrics.failureP95Ms, null);
  assert.equal(result.metrics.failureP99Ms, null);
  assert.equal(result.metrics.serverErrorPercent, null);
  assert.equal(result.metrics.responseBytesPerSecond, 0);
  assert.equal(result.parseErrorsTotal, 2);
});

test("fixed signal queries validate services and filter raw recording frames before all aggregation", async () => {
  for (const service of ["all", "website", "whiteboard", "study-agent"]) {
    const query = monitorSignalsQuery(service, true);
    assert.match(query, /timestamp\(server_monitor:http_requests:rate1m/);
    assert.match(query, /timestamp\(server_monitor_http_recorded_at_seconds/);
    assert.match(query, /histogram_quantile\(0\.95, sum by \(le\)/);
    assert.match(query, /histogram_quantile\(0\.99, sum by \(le\)/);
    assert.doesNotMatch(query, /last_over_time/);
    assert.match(query, /time\(\) - 9/);
    if (service === "all") assert.match(query, /service=~"website\|whiteboard\|study-agent"/);
    else assert.match(query, new RegExp(`service="${service}"`));
  }
  for (const service of ["", "ALL", 'website"} or vector(1)', "http://169.254.169.254", null]) {
    let calls = 0;
    await assert.rejects(readPrometheusSignalsCurrent(service, NOW, { env, request: async () => { calls++; } }), /invalid_service/);
    assert.equal(calls, 0);
  }
});

test("duplicate fields, duplicate source targets and malformed or failed responses are rejected", async () => {
  for (const result of [vector([...snapshot(), row("successP95Ms", 1)]), vector(snapshot({ exporterSeries: 2 })),
    vector(snapshot({ markerSeries: 2 })), vector([{ metric: { monitor_field: "requestsPerSecond" }, value: ["invalid", "1"] }]), matrix([])]) {
    await assert.rejects(readPrometheusSignalsCurrent("all", NOW, fixed(result)), /ambiguous_prometheus_series|invalid_prometheus_response/);
  }
  await assert.rejects(readPrometheusSignalsCurrent("all", NOW, { env, request: async () => { throw new Error("prometheus_unavailable"); } }), /prometheus_unavailable/);
});

test("all history windows use one bounded query and preserve absent or pre-instrumentation points", async () => {
  for (const [range, count, step] of [["1h", 1201, 3], ["24h", 289, 300], ["7d", 337, 1800]]) {
    let calls = 0;
    const result = await readPrometheusSignalsHistory("whiteboard", range, NOW, { env, request: async (_settings, path, params, signal) => {
      calls++;
      assert.equal(path, "/api/v1/query_range");
      assert.equal(params.timeout, "8s");
      assert.equal(Number(params.step), step);
      assert.equal(signal.aborted, false);
      return matrix([]);
    } });
    assert.equal(calls, 1);
    assert.equal(result.points.length, count);
    assert.equal(result.intervalSeconds, step);
    assert.ok(result.points.every((point) => MONITOR_SIGNAL_FIELDS.every((field) => point[field] === null)));
  }
});

test("history missing ticks, partial metric fields, zero traffic and NaN latency do not become false measurements", async () => {
  const end = Math.floor(NOW / 3000) * 3;
  const result = await readPrometheusSignalsHistory("all", "1h", NOW, fixed(matrix([
    { metric: { monitor_field: "requestsPerSecond" }, values: [[end - 6, "2"], [end, "0"]] },
    { metric: { monitor_field: "serverErrorPercent" }, values: [[end - 6, "50"], [end, "0"]] },
    { metric: { monitor_field: "successP95Ms" }, values: [[end - 6, "NaN"], [end, "20"]] },
  ])));
  assert.equal(result.points.at(-3).requestsPerSecond, 2);
  assert.equal(result.points.at(-3).serverErrorPercent, 50);
  assert.equal(result.points.at(-3).successP95Ms, null);
  assert.equal(result.points.at(-2).requestsPerSecond, null);
  assert.equal(result.points.at(-1).requestsPerSecond, 0);
  assert.equal(result.points.at(-1).serverErrorPercent, null);
  assert.equal(result.points.at(-1).successP95Ms, 20);
});

test("history refuses duplicated or out-of-window samples, oversized series and bad ranges before querying", async () => {
  const end = Math.floor(NOW / 3000) * 3;
  const entry = { metric: { monitor_field: "requestsPerSecond" }, values: [[end, "1"]] };
  for (const entries of [[entry, entry], [{ ...entry, values: [[end + 3, "1"]] }], [{ ...entry, values: [[end - 1, "1"]] }],
    [{ ...entry, values: [[end, "1"], [end, "2"]] }], [{ ...entry, values: Array(1202).fill([end, "1"]) }]]) {
    await assert.rejects(readPrometheusSignalsHistory("all", "1h", NOW, fixed(matrix(entries))), /ambiguous_prometheus_series|invalid_prometheus_response/);
  }
  let calls = 0;
  for (const range of ["30d", "toString", "__proto__", ""]) {
    await assert.rejects(readPrometheusSignalsHistory("all", range, NOW, { env, request: async () => { calls++; } }), /invalid_range/);
  }
  assert.equal(calls, 0);
});
