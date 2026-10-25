import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { mergeMonitorHistoryRows, prometheusSettings, readPrometheusCurrent, readPrometheusHistory, readPrometheusHistoryRows } from "../src/server/monitorPrometheus.js";

const NOW = Date.parse("2026-10-25T06:00:01.234Z");
const HOST = "cloud-primary";
const env = { MONITOR_PROMETHEUS_URL: "http://172.30.0.1:19091" };
function metric(name, number, labels = {}, at = NOW) {
  return { metric: { __name__: `server_monitor_${name}`, host_id: HOST, ...labels }, value: [at / 1000, String(number)] };
}
function vector(result) { return { resultType: "vector", result }; }
function snapshot(hostTime = NOW - 1000, checksTime = NOW - 12_000) {
  return [
    metric("host_collected_at_seconds", hostTime / 1000), metric("checks_collected_at_seconds", checksTime / 1000),
    metric("host_info", 1, { hostname: "server", mount: "/", interface: "eth0" }),
    metric("host_cpu_percent", 31.4), metric("host_cpu_cores", 2), metric("host_load1", 0.42),
    metric("host_memory_total_bytes", 2000), metric("host_memory_used_bytes", 500), metric("host_memory_used_percent", 25),
    metric("host_swap_total_bytes", 0), metric("host_swap_used_percent", 0), metric("host_disk_total_bytes", 10_000),
    metric("host_disk_read_bytes_per_second", 345), metric("host_network_rx_bytes_per_second", 123), metric("host_uptime_seconds", 200),
    metric("container_info", 1, { name: "website", image: "website:abc123", state: "running", health: "healthy" }),
    metric("container_cpu_percent", 132, { name: "website" }), metric("container_memory_percent", 12, { name: "website" }), metric("container_restart_count", 1, { name: "website" }),
    metric("service_info", 1, { id: "jenkins", name: "Jenkins", kind: "http", status: "reachable", detail: "认证重定向" }),
    metric("service_http_status", 303, { id: "jenkins" }), metric("service_latency_ms", 7, { id: "jenkins" }),
  ];
}
function fixed(entries) { return { env, request: async () => vector(entries) }; }

test("private Prometheus URL has a fixed port and no DNS, credentials, paths or proxy target", () => {
  assert.equal(prometheusSettings(env).origin, "http://172.30.0.1:19091");
  assert.equal(prometheusSettings({}).origin, "http://127.0.0.1:19090");
  for (const url of ["https://172.30.0.1:19091", "http://prometheus:19091", "http://8.8.8.8:19091", "http://169.254.169.254:19091", "http://127.0.0.1:3000", "http://user:pass@127.0.0.1:19090", "http://127.0.0.1:19090/api", "http://127.0.0.1:19090/?target=x", "http://127.0.0.1:19090/#x"]) {
    assert.throws(() => prometheusSettings({ MONITOR_PROMETHEUS_URL: url }));
  }
});

test("current maps real capture times, host fields, Docker CPU above one core and HTTP redirects", async () => {
  const current = await readPrometheusCurrent(NOW, fixed(snapshot()));
  assert.equal(current.stale, false);
  assert.equal(current.checksStale, false);
  assert.equal(current.sample.collectedAt, new Date(NOW - 1000).toISOString());
  assert.equal(current.sample.checksCollectedAt, new Date(NOW - 12_000).toISOString());
  assert.equal(current.sample.host.hostname, "server");
  assert.equal(current.sample.host.cpu.percent, 31.4);
  assert.equal(current.sample.host.cpu.load1, 0.42);
  assert.equal(current.sample.host.network.rxBytesPerSecond, 123);
  assert.equal(current.sample.host.disk.readBytesPerSecond, 345);
  assert.equal(current.sample.host.uptimeSeconds, 200);
  assert.equal(current.sample.containers[0].cpuPercent, 132);
  assert.equal(current.sample.containers[0].image, "website:abc123");
  assert.equal(current.sample.services[0].status, "reachable");
  assert.equal(current.sample.services[0].httpStatus, 303);
});

test("missing, NaN, infinity and invalid percentages remain null; zero remains zero", async () => {
  const entries = snapshot().filter((entry) => !entry.metric.__name__.endsWith("host_cpu_percent"));
  entries.push(metric("host_cpu_percent", "NaN"), metric("host_network_tx_bytes_per_second", "+Inf"), metric("host_memory_available_bytes", -1), metric("host_disk_used_percent", 101));
  const { sample } = await readPrometheusCurrent(NOW, fixed(entries));
  assert.equal(sample.host.cpu.percent, null);
  assert.equal(sample.host.cpu.load5, null);
  assert.equal(sample.host.network.txBytesPerSecond, null);
  assert.equal(sample.host.memory.availableBytes, null);
  assert.equal(sample.host.disk.usedPercent, null);
  assert.equal(sample.host.swap.totalBytes, 0);
  assert.equal(sample.host.swap.usedPercent, 0);
});

test("host and slow checks expire independently based on capture value rather than vector evaluation time", async () => {
  const current = await readPrometheusCurrent(NOW, fixed(snapshot(NOW - 46_000, NOW - 10_000)));
  assert.equal(current.stale, true);
  assert.equal(current.checksStale, false);
  assert.equal(Date.parse(current.sample.collectedAt), NOW - 46_000);
  const slow = await readPrometheusCurrent(NOW, fixed(snapshot(NOW, NOW - 45_001)));
  assert.equal(slow.stale, false);
  assert.equal(slow.checksStale, true);
});

test("successful scrape omissions cannot resurrect old resource values or changed info labels", async () => {
  let calls = 0;
  const entries = snapshot().filter((entry) => !entry.metric.__name__.includes("container_cpu_percent"));
  const current = await readPrometheusCurrent(NOW, { env, request: async (_settings, _path, params) => {
    calls++;
    assert.doesNotMatch(params.query, /last_over_time/);
    return vector(entries);
  } });
  assert.equal(calls, 1);
  assert.equal(current.sample.containers[0].cpuPercent, null);
  assert.equal(current.sample.containers.length, 1);
});

test("exporter outage restores a whole last snapshot at its original time, preserving the 45 second grace", async () => {
  const capture = NOW - 30_000, calls = [];
  const current = await readPrometheusCurrent(NOW, { env, request: async (_settings, _path, params) => {
    calls.push(params);
    if (calls.length === 1) return vector(snapshot().filter((entry) => /^server_monitor_(checks_|service_|container_)/.test(entry.metric.__name__)));
    if (calls.length === 2) return vector([{ metric: { host_id: HOST, monitor_group: "host" }, value: [NOW / 1000, String(capture / 1000)] }]);
    assert.equal(Number(params.time), capture / 1000 + 0.001);
    return vector(snapshot(capture).filter((entry) => entry.metric.__name__.startsWith("server_monitor_host_")));
  } });
  assert.equal(calls.length, 3);
  assert.equal(current.stale, false);
  assert.equal(Date.parse(current.sample.collectedAt), capture);
  assert.equal(current.sample.containers.length, 1);
  assert.match(calls[1].query, /last_over_time\(server_monitor_host_collected_at_seconds.*\[7d\]/);
});

test("outage beyond 45 seconds remains stale after historical snapshot retrieval", async () => {
  const capture = NOW - 61_000;
  const current = await readPrometheusCurrent(NOW, { env, request: async (_settings, _path, params) => {
    if (params.query.includes("last_over_time")) return vector(["host", "checks"].map((group) => ({ metric: { host_id: HOST, monitor_group: group }, value: [NOW / 1000, String(capture / 1000)] })));
    if (Number(params.time) === NOW / 1000) return vector([]);
    return vector(snapshot(capture, capture).filter((entry) => params.query.includes("server_monitor_host_.+") ? entry.metric.__name__.startsWith("server_monitor_host_") : /^server_monitor_(checks_|service_|container_)/.test(entry.metric.__name__)));
  } });
  assert.equal(current.stale, true);
  assert.equal(current.checksStale, true);
  assert.equal(Date.parse(current.sample.collectedAt), capture);
});

test("no retained capture returns no sample, not fabricated fresh data", async () => {
  const current = await readPrometheusCurrent(NOW, fixed([]));
  assert.equal(current.sample, null);
  assert.equal(current.stale, true);
  assert.equal(current.checksStale, true);
});

test("wrong-host data cannot be displayed and duplicate metric targets fail explicitly", async () => {
  const current = await readPrometheusCurrent(NOW, fixed(snapshot().map((entry) => ({ ...entry, metric: { ...entry.metric, host_id: "other" } }))));
  assert.equal(current.sample, null);
  await assert.rejects(readPrometheusCurrent(NOW, fixed([...snapshot(), metric("host_cpu_percent", 10, { instance: "duplicate" })])), /ambiguous/);
  await assert.rejects(readPrometheusCurrent(NOW, fixed([...snapshot(), metric("container_info", 1, { name: "website", image: "old", state: "exited", health: "unknown" })])), /ambiguous/);
});

test("Prometheus errors and malformed result types propagate instead of returning legacy current", async () => {
  await assert.rejects(readPrometheusCurrent(NOW, { env, request: async () => { throw new Error("offline"); } }), /offline/);
  await assert.rejects(readPrometheusCurrent(NOW, { env, request: async () => ({ resultType: "matrix", result: [] }) }), /invalid_prometheus/);
});

test("current queries keep the short timeout while historical aggregation has a bounded longer allowance", async () => {
  await readPrometheusCurrent(NOW, { env, request: async (_settings, _path, params, signal) => {
    assert.equal(params.timeout, "5s");
    assert.equal(signal.aborted, false);
    return vector(snapshot());
  } });
  await readPrometheusHistory("7d", NOW, { env, request: async (_settings, path, params, signal) => {
    assert.equal(params.timeout, "8s");
    assert.equal(signal.aborted, false);
    return { resultType: path.endsWith("query_range") ? "matrix" : "vector", result: [] };
  } });
});

function series(field, stat, pairs, matrix = true) {
  return { metric: { host_id: HOST, monitor_field: field, monitor_stat: stat }, [matrix ? "values" : "value"]: pairs };
}

test("one-hour history keeps missing scrapes as null and uses raw range windows instead of lookback", async () => {
  const calls = [];
  const history = await readPrometheusHistory("1h", NOW, { env, request: async (_settings, path, params) => {
    calls.push({ path, params });
    assert.match(params.query, /avg_over_time/);
    assert.match(params.query, /count_over_time/);
    assert.doesNotMatch(params.query, /last_over_time/);
    if (path.endsWith("query_range")) {
      const start = Number(params.start);
      assert.match(params.query, /\[3000ms\]/);
      return { resultType: "matrix", result: [series("cpuPercent", "mean", [[start, "10"], [start + 6, "20"]]), series("cpuPercent", "count", [[start, "1"], [start + 6, "1"]])] };
    }
    assert.match(params.query, /\[1235ms\]/);
    return vector([series("cpuPercent", "mean", [NOW / 1000, "30"], false), series("cpuPercent", "count", [NOW / 1000, "1"], false)]);
  } });
  assert.equal(calls.length, 2);
  assert.equal(history.intervalSeconds, 3);
  assert.equal(history.points.length, 1201);
  assert.equal(history.points[0].cpuPercent, 10);
  assert.equal(history.points[1].cpuPercent, null);
  assert.equal(history.points[2].cpuPercent, 20);
  assert.equal(history.points.at(-1).cpuPercent, 30);
  assert.equal(history.points.at(-1).memoryPercent, null);
});

test("24 hour and 7 day windows use their bounded bucket counts and aggregation steps", async () => {
  for (const [range, step, count] of [["24h", 300, 289], ["7d", 1800, 337]]) {
    const history = await readPrometheusHistory(range, NOW, { env, request: async (_settings, path, params) => {
      if (path.endsWith("query_range")) { assert.equal(Number(params.step), step); assert.match(params.query, new RegExp(`\\[${step * 1000}ms\\]`)); }
      return { resultType: path.endsWith("query_range") ? "matrix" : "vector", result: [] };
    } });
    assert.equal(history.points.length, count);
    assert.equal(history.intervalSeconds, step);
    assert.ok(history.points.every((point) => point.cpuPercent === null));
  }
});

test("cutover clips the first Prometheus bucket to prevent pre-cutover samples entering aggregation", async () => {
  const after = Date.parse("2026-10-25T05:57:10.500Z"), calls = [];
  const rows = await readPrometheusHistoryRows("24h", NOW, { env, after, request: async (_settings, path, params) => {
    calls.push({ path, params });
    return vector([series("cpuPercent", "mean", [Number(params.time), "40"], false), series("cpuPercent", "count", [Number(params.time), "2"], false)]);
  } });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.path.endsWith("/query")));
  assert.match(calls[0].params.query, /\[169500ms\]/);
  assert.equal(Number(calls[0].params.time), Date.parse("2026-10-25T05:59:59.999Z") / 1000);
  assert.deepEqual(rows.map((row) => row.collectedAt), ["2026-10-25T05:55:00.000Z", "2026-10-25T06:00:00.000Z"]);
  assert.deepEqual(await readPrometheusHistoryRows("1h", NOW, { env, after: NOW + 1, request: async () => { throw new Error("must not query future"); } }), []);
});

test("cutover averages combine per-field sample counts, and missing values stay gaps", () => {
  const collectedAt = "2026-10-25T06:00:00.000Z";
  const history = mergeMonitorHistoryRows([{ collectedAt, cpuPercent: 20, cpuPercentCount: "3", memoryPercent: null, memoryPercentCount: "0" }], [{ collectedAt, cpuPercent: 40, cpuPercentCount: 2, memoryPercent: 50, memoryPercentCount: 1 }], "24h", NOW);
  assert.equal(history.points.at(-1).cpuPercent, 28);
  assert.equal(history.points.at(-1).memoryPercent, 50);
  assert.equal(history.points.at(-1).swapPercent, null);
  assert.equal(history.points.at(-2).cpuPercent, null);
});

test("bad range and duplicate historical target series are rejected", async () => {
  await assert.rejects(readPrometheusHistory("invalid", NOW, fixed([])), /invalid_range/);
  await assert.rejects(readPrometheusHistory("1h", NOW, { env, request: async (_settings, path, params) => {
    if (!path.endsWith("query_range")) return vector([]);
    const item = series("cpuPercent", "mean", [[Number(params.start), "10"]]);
    return { resultType: "matrix", result: [item, { ...item, metric: { ...item.metric, instance: "duplicate" } }] };
  } }), /ambiguous/);
});

test("native transport refuses redirects, malformed and oversized bodies, and obeys deadline", async (t) => {
  let handler = (_request, response) => { response.writeHead(302, { Location: "http://example.com" }); response.end(); };
  const server = http.createServer((request, response) => handler(request, response));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(19090, "127.0.0.1", resolve); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const local = { env: { MONITOR_PROMETHEUS_URL: "http://127.0.0.1:19090" } };
  await assert.rejects(readPrometheusCurrent(NOW, local), /prometheus_unavailable/);
  handler = (_request, response) => response.end("not json");
  await assert.rejects(readPrometheusCurrent(NOW, local), /invalid_prometheus_response/);
  handler = (_request, response) => { response.writeHead(200, { "Content-Length": 3 * 1024 * 1024 }); response.end(); };
  await assert.rejects(readPrometheusCurrent(NOW, local), /too_large/);
  handler = (_request, response) => response.end("x".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(readPrometheusCurrent(NOW, local), /too_large/);
  handler = () => {};
  await assert.rejects(readPrometheusCurrent(NOW, { ...local, signal: AbortSignal.timeout(30) }), { name: "AbortError" });
});
