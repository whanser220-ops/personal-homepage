import assert from "node:assert/strict";
import test from "node:test";
import { readStandardMonitorChecks } from "../src/server/monitorStandardChecks.js";
import { monitorExporterMode, prometheusSettings, readPrometheusCurrent, readPrometheusHistory } from "../src/server/monitorPrometheus.js";

const NOW = Date.parse("2026-10-26T00:00:00.000Z"), CUSTOM = NOW - 3000, CADVISOR = NOW - 5000, BEFORE = CADVISOR - 15_000, BLACKBOX = NOW - 4000;
const ids = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
const names = ["personal-homepage", "learning-whiteboard", "personal-homepage-postgres"];
const processIds = ["study-agent", "study-agent-remote", "nginx", "docker", "postgres"];
const probes = [["website", "http", 200], ["whiteboard", "http", 302], ["jenkins", "http", 303], ["study-agent-http", "http", 401], ["remote-run-port", "tcp", null], ["perforce", "tcp", null]];
function metric(name, job, labels, values) { return { metric: { __name__: name, host_id: "cloud-primary", job, ...labels }, values: values.map(([time, value]) => [time / 1000, String(value)]) }; }
function fixture() {
  const rows = [
    metric("up", "server-monitor-custom", {}, [[CUSTOM, 1]]),
    metric("server_monitor_custom_collected_at_seconds", "server-monitor-custom", {}, [[CUSTOM, (CUSTOM + 1) / 1000]]),
    metric("up", "server-monitor-cadvisor", {}, [[BEFORE, 1], [CADVISOR, 1]]),
  ];
  for (let i = 0; i < names.length; i++) {
    rows.push(metric("server_monitor_custom_container_info", "server-monitor-custom", { name: names[i], container_id: ids[i], image: `site:v${i}`, state: "running", health: "healthy" }, [[CUSTOM, 1]]));
    rows.push(metric("server_monitor_custom_container_restart_count", "server-monitor-custom", { name: names[i], container_id: ids[i] }, [[CUSTOM, i]]));
    const labels = i === 0 ? { id: `/system.slice/docker-${ids[i]}.scope`, name: names[i] } : i === 1 ? { id: `/docker/${ids[i]}`, name: names[i] } : { container_id: ids[i], name: names[i] };
    rows.push(metric("container_cpu_usage_seconds_total", "server-monitor-cadvisor", { ...labels, cpu: "total" }, [[BEFORE, 10], [CADVISOR, i === 0 ? 32.5 : 10]]));
    rows.push(metric("container_memory_working_set_bytes", "server-monitor-cadvisor", labels, [[BEFORE, 400], [CADVISOR, 500]]));
    rows.push(metric("container_spec_memory_limit_bytes", "server-monitor-cadvisor", labels, [[BEFORE, 1000], [CADVISOR, 1000]]));
    rows.push(metric("container_last_seen", "server-monitor-cadvisor", labels, [[BEFORE, BEFORE / 1000], [CADVISOR, CADVISOR / 1000]]));
  }
  for (const id of processIds) rows.push(metric("server_monitor_custom_service_info", "server-monitor-custom", { id, name: id, kind: "process", status: "healthy", detail: "process active" }, [[CUSTOM, 1]]));
  for (const [id, kind, code] of probes) {
    const labels = { id, kind, name: id };
    rows.push(metric("up", "server-monitor-blackbox", labels, [[BLACKBOX, 1]]));
    rows.push(metric("probe_success", "server-monitor-blackbox", labels, [[BLACKBOX, 1]]));
    rows.push(metric("probe_duration_seconds", "server-monitor-blackbox", labels, [[BLACKBOX, 0.012]]));
    if (code !== null) rows.push(metric("probe_http_status_code", "server-monitor-blackbox", labels, [[BLACKBOX, code]]));
  }
  return { resultType: "matrix", result: rows };
}
function row(data, name, predicate = () => true) { return data.result.find((entry) => entry.metric.__name__ === name && predicate(entry.metric)); }
const read = (data, now = NOW) => readStandardMonitorChecks(data, now, 2000);

test("standard sources preserve all 3 containers and 11 service semantics with actual capture times", () => {
  const checks = read(fixture());
  assert.equal(checks.containers.length, 3);
  assert.equal(checks.services.length, 11);
  assert.equal(checks.checksStale, false);
  assert.equal(Date.parse(checks.checksCollectedAt), CADVISOR);
  assert.equal(checks.containers[0].cpuPercent, 150);
  assert.equal(checks.containers[1].cpuPercent, 0);
  assert.equal(checks.containers[0].memoryBytes, 500);
  assert.equal(checks.containers[0].memoryLimitBytes, 1000);
  assert.equal(checks.containers[0].memoryPercent, 50);
  assert.equal(checks.containers[0].restartCount, 0);
  assert.equal(checks.services.find((item) => item.id === "website").status, "healthy");
  assert.equal(checks.services.find((item) => item.id === "jenkins").status, "reachable");
  assert.equal(checks.services.find((item) => item.id === "jenkins").httpStatus, 303);
  assert.equal(checks.services.find((item) => item.id === "remote-run-port").status, "reachable");
  assert.equal(checks.services.find((item) => item.id === "postgres").kind, "process");
  assert.equal(checks.services.find((item) => item.id === "postgres").httpStatus, null);
});

test("custom old image and status labels are excluded by their own actual scrape frame", () => {
  const data = fixture();
  data.result.push(metric("server_monitor_custom_container_info", "server-monitor-custom", { name: names[0], container_id: "d".repeat(64), image: "old:v0", state: "exited", health: "unknown" }, [[CUSTOM - 15_000, 1]]));
  data.result.push(metric("server_monitor_custom_service_info", "server-monitor-custom", { id: "postgres", status: "unhealthy" }, [[CUSTOM - 15_000, 1]]));
  const checks = read(data);
  assert.equal(checks.containers[0].image, "site:v0");
  assert.equal(checks.containers[0].state, "running");
  assert.equal(checks.services.find((item) => item.id === "postgres").status, "healthy");
});

test("rebuilt container IDs never receive the old same-name container's resources", () => {
  const data = fixture();
  row(data, "server_monitor_custom_container_info", (labels) => labels.name === names[0]).metric.container_id = "d".repeat(64);
  row(data, "server_monitor_custom_container_restart_count", (labels) => labels.name === names[0]).metric.container_id = "d".repeat(64);
  const checks = read(data);
  assert.equal(checks.containers[0].cpuPercent, null);
  assert.equal(checks.containers[0].memoryBytes, null);
  assert.equal(checks.containers[1].memoryBytes, 500);
});

test("omitted current cAdvisor gauge is null even when an older value exists", () => {
  const data = fixture();
  row(data, "container_memory_working_set_bytes", (labels) => labels.name === names[0]).values.pop();
  assert.equal(read(data).containers[0].memoryBytes, null);
  assert.equal(read(data).containers[0].memoryPercent, null);
});

test("missing current last_seen cannot fabricate fresh resources from scrape time", () => {
  const data = fixture();
  row(data, "container_last_seen", (labels) => labels.name === names[0]).values.pop();
  const checks = read(data);
  assert.equal(checks.containers[0].cpuPercent, null);
  assert.equal(checks.containers[0].memoryBytes, null);
  assert.equal(checks.containers[0].memoryLimitBytes, null);
  assert.equal(checks.checksStale, true);
  assert.equal(checks.containers[1].memoryBytes, 500);
});

test("failed cAdvisor scrape does not silently replay old resources", () => {
  const data = fixture();
  row(data, "up", (labels) => labels.job === "server-monitor-cadvisor").values.push([(CADVISOR + 1000) / 1000, "0"]);
  const checks = read(data);
  assert.ok(checks.containers.every((item) => item.cpuPercent === null && item.memoryBytes === null));
  assert.equal(checks.services.find((item) => item.id === "website").status, "healthy");
  assert.equal(read(data, NOW + 50_000).checksStale, true);
});

test("cAdvisor last_seen and cached custom capture control freshness instead of scrape evaluation time", () => {
  const data = fixture();
  row(data, "container_last_seen", (labels) => labels.name === names[0]).values.at(-1)[1] = String((NOW - 46_000) / 1000);
  let checks = read(data);
  assert.equal(checks.checksStale, true);
  assert.equal(Date.parse(checks.checksCollectedAt), NOW - 46_000);
  assert.equal(checks.containers[0].memoryBytes, null);
  const custom = fixture();
  row(custom, "server_monitor_custom_collected_at_seconds").values[0][1] = String((NOW - 47_000) / 1000);
  checks = read(custom);
  assert.equal(checks.checksStale, true);
  assert.equal(Date.parse(checks.checksCollectedAt), NOW - 47_000);
});

for (const code of [303, 401, 403]) test(`HTTP ${code} remains reachable even when generic success classification differs`, () => {
  const data = fixture();
  row(data, "probe_http_status_code", (labels) => labels.id === "website").values[0][1] = String(code);
  row(data, "probe_success", (labels) => labels.id === "website").values[0][1] = "0";
  const service = read(data).services.find((item) => item.id === "website");
  assert.equal(service.status, "reachable");
  assert.equal(service.httpStatus, code);
  assert.equal(service.latencyMs, 12);
});

test("HTTP failure, TCP failure and missing exporter are distinct from health", () => {
  const data = fixture();
  row(data, "probe_http_status_code", (labels) => labels.id === "website").values[0][1] = "503";
  row(data, "probe_success", (labels) => labels.id === "perforce").values[0][1] = "0";
  row(data, "up", (labels) => labels.id === "jenkins").values.push([(BLACKBOX + 1000) / 1000, "0"]);
  const checks = read(data);
  assert.equal(checks.services.find((item) => item.id === "website").status, "unhealthy");
  assert.equal(checks.services.find((item) => item.id === "perforce").status, "unhealthy");
  const jenkins = checks.services.find((item) => item.id === "jenkins");
  assert.equal(jenkins.status, "unknown");
  assert.equal(jenkins.httpStatus, null);
  assert.equal(jenkins.latencyMs, null);
});

test("first CPU frame, counter reset and a failed intervening scrape stay unknown", () => {
  const first = fixture();
  row(first, "container_cpu_usage_seconds_total", (labels) => labels.name === names[0]).values.shift();
  assert.equal(read(first).containers[0].cpuPercent, null);
  const reset = fixture();
  row(reset, "container_cpu_usage_seconds_total", (labels) => labels.name === names[0]).values.at(-1)[1] = "1";
  assert.equal(read(reset).containers[0].cpuPercent, null);
  const interrupted = fixture();
  row(interrupted, "up", (labels) => labels.job === "server-monitor-cadvisor").values.splice(1, 0, [(BEFORE + 7500) / 1000, "0"]);
  assert.equal(read(interrupted).containers[0].cpuPercent, null);
});

test("repeated last_seen retains its seen age while CPU uses the actual two scrape observations", () => {
  const data = fixture(), older = BEFORE - 15_000;
  row(data, "up", (labels) => labels.job === "server-monitor-cadvisor").values.unshift([older / 1000, "1"]);
  const cpu = row(data, "container_cpu_usage_seconds_total", (labels) => labels.name === names[0]);
  cpu.values = [[older / 1000, "10"], [BEFORE / 1000, "25"], [CADVISOR / 1000, "25"]];
  const seen = row(data, "container_last_seen", (labels) => labels.name === names[0]);
  seen.values = [[older / 1000, String(older / 1000)], [BEFORE / 1000, String(BEFORE / 1000)], [CADVISOR / 1000, String(BEFORE / 1000)]];
  const checks = read(data);
  assert.equal(checks.containers[0].cpuPercent, 0);
  assert.equal(Date.parse(checks.checksCollectedAt), BEFORE);
  assert.equal(checks.checksStale, false);
});

test("CPU interval uses precise scrape timestamps instead of the integer last_seen clock", () => {
  const data = fixture();
  for (const item of data.result.filter((entry) => entry.metric.job === "server-monitor-cadvisor")) {
    for (const pair of item.values) if (pair[0] === CADVISOR / 1000) pair[0] = (CADVISOR + 450) / 1000;
  }
  const checks = read(data);
  assert.ok(Math.abs(checks.containers[0].cpuPercent - (22.5 / 15.45 * 100)) < 0.000001);
});

test("CPU per-core counters combine only distinct cores when no total series exists", () => {
  const data = fixture();
  const cpu = row(data, "container_cpu_usage_seconds_total", (labels) => labels.name === names[0]);
  cpu.metric.cpu = "cpu00";
  cpu.values.at(-1)[1] = "25";
  data.result.push(metric("container_cpu_usage_seconds_total", "server-monitor-cadvisor", { ...cpu.metric, cpu: "cpu01" }, [[BEFORE, 20], [CADVISOR, 27.5]]));
  assert.equal(read(data).containers[0].cpuPercent, 150);
});

test("unlimited cgroup memory uses actual host memory as its effective limit", () => {
  const data = fixture();
  row(data, "container_spec_memory_limit_bytes", (labels) => labels.name === names[0]).values.at(-1)[1] = "9223372036854771712";
  const checks = read(data);
  assert.equal(checks.containers[0].memoryLimitBytes, 2000);
  assert.equal(checks.containers[0].memoryPercent, 25);
  assert.equal(readStandardMonitorChecks(data, NOW).containers[0].memoryLimitBytes, null);
  row(data, "container_spec_memory_limit_bytes", (labels) => labels.name === names[0]).values.at(-1)[1] = "0";
  assert.equal(read(data).containers[0].memoryLimitBytes, 2000);
  assert.equal(read(data).containers[0].memoryPercent, 25);
  assert.equal(readStandardMonitorChecks(data, NOW).containers[0].memoryLimitBytes, null);
});

test("missing standard source yields unknowns and expired checks, not a legacy Python fallback", () => {
  const data = fixture();
  data.result = data.result.filter((entry) => entry.metric.job !== "server-monitor-custom");
  const checks = read(data);
  assert.equal(checks.checksStale, true);
  assert.ok(checks.containers.every((item) => item.image === null && item.memoryBytes === null));
  assert.equal(checks.services.find((item) => item.id === "postgres").status, "unknown");
});

test("genuine duplicate exporter targets and same-frame metadata remain errors", () => {
  const data = fixture();
  data.result.push({ ...row(data, "up", (labels) => labels.job === "server-monitor-custom"), metric: { __name__: "up", host_id: "cloud-primary", job: "server-monitor-custom", instance: "duplicate" } });
  assert.throws(() => read(data), /ambiguous/);
  const metadata = fixture();
  const original = row(metadata, "server_monitor_custom_container_info");
  metadata.result.push({ ...original, metric: { ...original.metric, image: "duplicate:v1" } });
  assert.throws(() => read(metadata), /ambiguous/);
});

test("standard mode preserves the public sample schema and the host atomic frame", async () => {
  const data = fixture();
  data.result.push(metric("server_monitor_host_collected_at_seconds", "server-monitor-host", {}, [[NOW - 1000, (NOW - 1100) / 1000]]));
  data.result.push(metric("server_monitor_host_info", "server-monitor-host", { hostname: "host", mount: "/", interface: "eth0" }, [[NOW - 1000, 1]]));
  data.result.push(metric("server_monitor_host_memory_total_bytes", "server-monitor-host", {}, [[NOW - 1000, 2000]]));
  data.result.push(metric("server_monitor_host_cpu_percent", "server-monitor-host", {}, [[NOW - 1000, 12.5]]));
  const current = await readPrometheusCurrent(NOW, { env: { MONITOR_EXPORTER_MODE: "standard", MONITOR_PROMETHEUS_URL: "http://172.30.0.1:19095" }, request: async (_settings, _path, params) => {
    assert.match(params.query, /cpu_usage_seconds_total/);
    assert.match(params.query, /probe_/);
    return data;
  } });
  assert.equal(current.sample.host.cpu.percent, 12.5);
  assert.equal(current.sample.containers[0].cpuPercent, 150);
  assert.equal(current.sample.services.length, 11);
  assert.equal(current.sample.collectedAt, new Date(NOW - 1100).toISOString());
  assert.equal(current.checksStale, false);
  assert.equal(current.stale, false);
});

test("standard mode retains the existing historical metric names and aggregation", async () => {
  const history = await readPrometheusHistory("24h", NOW, { env: { MONITOR_EXPORTER_MODE: "standard" }, request: async (_settings, path, params) => {
    assert.match(params.query, /server_monitor_host_cpu_percent/);
    assert.doesNotMatch(params.query, /container_cpu_usage/);
    return { resultType: path.endsWith("query_range") ? "matrix" : "vector", result: [] };
  } });
  assert.equal(history.points.length, 289);
  assert.equal(monitorExporterMode({}), "legacy");
  assert.equal(monitorExporterMode({ MONITOR_EXPORTER_MODE: "standard" }), "standard");
  assert.throws(() => monitorExporterMode({ MONITOR_EXPORTER_MODE: "typo" }), /invalid_monitor_exporter_mode/);
  assert.equal(prometheusSettings({ MONITOR_PROMETHEUS_URL: "http://127.0.0.1:19094" }).origin, "http://127.0.0.1:19094");
  assert.throws(() => prometheusSettings({ MONITOR_PROMETHEUS_URL: "http://127.0.0.1:19092" }), /invalid_monitor_prometheus_url/);
});
