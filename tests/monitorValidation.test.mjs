import test from "node:test";
import assert from "node:assert/strict";
import { buildMonitorHistoryPoints, MONITOR_MAX_BODY_BYTES, MonitorValidationError, normalizeMonitorBatch, normalizeMonitorSample } from "../src/server/monitorValidation.js";
import { readMonitorJsonBody } from "../src/server/monitorHttp.js";

const now = Date.parse("2026-10-23T12:00:00Z");
function sample() {
  return { hostId: "cloud-primary", collectedAt: new Date(now).toISOString(), host: {
    hostname: "cloud-primary", cpu: { percent: 10, load1: 1, load5: 0.5, load15: 0.25, cores: 2 },
    memory: { totalBytes: 1024, availableBytes: 512, usedBytes: 512, usedPercent: 50 },
    swap: { totalBytes: 0, usedBytes: 0, usedPercent: 0 },
    disk: { mount: "/", totalBytes: 1024, usedBytes: 256, availableBytes: 768, usedPercent: 25, readBytesPerSecond: null, writeBytesPerSecond: null },
    network: { interface: "eth0", rxBytesPerSecond: null, txBytesPerSecond: null }, uptimeSeconds: 123,
  }, containers: [{ name: "web", image: "registry/web:main@sha256:abc", state: "running", health: null,
    restartCount: 0, cpuPercent: 125, memoryBytes: 128, memoryLimitBytes: 1024, memoryPercent: 12.5 }],
  services: [{ id: "jenkins", name: "Jenkins", kind: "http", status: "reachable", latencyMs: 20, httpStatus: 302, detail: "Authentication redirect" }] };
}

test("sample normalization preserves missing first-sample rates, Docker CPU over one core and authentication redirects", () => {
  const normalized = normalizeMonitorSample(sample(), now);
  assert.equal(normalized.host.disk.readBytesPerSecond, null);
  assert.equal(normalized.containers[0].cpuPercent, 125);
  assert.equal(normalized.services[0].status, "reachable");
  assert.equal(normalized.services[0].httpStatus, 302);
  assert.equal(normalized.checksCollectedAt, normalized.collectedAt, "legacy checks use their original sample time");
});

test("host-only samples stay sparse while completed empty checks remain an explicit snapshot", () => {
  const value = sample();
  delete value.containers;
  delete value.services;
  value.host.network.interface = null;
  const normalized = normalizeMonitorSample(value, now);
  for (const key of ["containers", "services", "checksCollectedAt"]) assert.equal(Object.hasOwn(normalized, key), false);
  assert.equal(normalized.host.network.interface, null);
  const empty = normalizeMonitorSample({ ...value, containers: [], services: [], checksCollectedAt: value.collectedAt }, now);
  assert.deepEqual(empty.containers, []);
  assert.deepEqual(empty.services, []);
  assert.equal(empty.checksCollectedAt, value.collectedAt);
  assert.equal(normalizeMonitorBatch({ samples: [value, sample(), empty] }, now).length, 3);
});

test("partial detail fields cannot imply a completed or fresh check snapshot", () => {
  for (const mutate of [
    (value) => { delete value.containers; },
    (value) => { delete value.services; },
    (value) => { delete value.containers; delete value.services; value.checksCollectedAt = value.collectedAt; },
    (value) => { delete value.containers; value.checksCollectedAt = value.collectedAt; },
    (value) => { value.containers = null; },
    (value) => { value.services = null; },
  ]) {
    const value = sample(); mutate(value);
    assert.throws(() => normalizeMonitorSample(value, now), MonitorValidationError);
  }
});

test("check capture times are retained UTC timestamps no later than their host sample", () => {
  const value = sample();
  value.checksCollectedAt = "2026-10-23T11:59:45Z";
  assert.equal(normalizeMonitorSample(value, now).checksCollectedAt, "2026-10-23T11:59:45.000Z");
  value.checksCollectedAt = value.collectedAt;
  assert.equal(normalizeMonitorSample(value, now).checksCollectedAt, value.collectedAt);
  value.checksCollectedAt = new Date(now - 7 * 86400_000).toISOString();
  assert.equal(normalizeMonitorSample(value, now).checksCollectedAt, value.checksCollectedAt);
  for (const time of [new Date(now + 1).toISOString(), new Date(now - 7 * 86400_000 - 1).toISOString(),
    "2026-02-30T11:59:45Z", "2026-10-23T11:59:45+00:00", "not-a-date", null, undefined]) {
    value.checksCollectedAt = time;
    assert.throws(() => normalizeMonitorSample(value, now), MonitorValidationError);
  }
});

test("unknown fields cannot smuggle container environment variables or health logs into storage", () => {
  for (const mutate of [
    (value) => { value.environment = { TOKEN: "private" }; },
    (value) => { value.containers[0].Env = ["TOKEN=private"]; },
    (value) => { value.host.network.headers = { authorization: "private" }; },
  ]) {
    const value = sample(); mutate(value);
    assert.throws(() => normalizeMonitorSample(value, now), MonitorValidationError);
  }
  const value = sample(); value.services[0].detail = "secret=private";
  assert.equal(normalizeMonitorSample(value, now).services[0].detail, "[redacted]");
});

test("validation rejects nonnumeric values, out-of-range percentages and duplicate services", () => {
  for (const mutate of [
    (value) => { value.host.memory.usedPercent = "50"; },
    (value) => { value.host.cpu.percent = 101; },
    (value) => { value.host.network.rxBytesPerSecond = -1; },
    (value) => { value.services.push({ ...value.services[0] }); },
    (value) => { value.hostId = "other-host"; },
    (value) => { value.services[0].httpStatus = 99; },
  ]) {
    const value = sample(); mutate(value);
    assert.throws(() => normalizeMonitorSample(value, now), MonitorValidationError);
  }
});

test("backfill accepts old retained samples but rejects expired and future timestamps", () => {
  const value = sample();
  value.collectedAt = new Date(now - 60 * 60 * 1000).toISOString();
  assert.equal(normalizeMonitorBatch({ samples: [value, sample()] }, now).length, 2);
  for (const time of [now - 7 * 86400 * 1000 - 1, now + 60_001]) {
    value.collectedAt = new Date(time).toISOString();
    assert.throws(() => normalizeMonitorSample(value, now), MonitorValidationError);
  }
  assert.throws(() => normalizeMonitorBatch({ samples: [] }, now), MonitorValidationError);
  assert.throws(() => normalizeMonitorBatch({ samples: Array(241).fill(sample()) }, now), MonitorValidationError);
});

test("all history windows preserve missing buckets as null rather than invented zeroes", () => {
  for (const [range, count, interval] of [["1h", 1201, 3], ["24h", 289, 300], ["7d", 337, 1800]]) {
    const result = buildMonitorHistoryPoints([{ collectedAt: new Date(now), cpuPercent: "17.5", memoryPercent: 0 }], range, now);
    assert.equal(result.intervalSeconds, interval);
    assert.equal(result.points.length, count);
    assert.equal(result.points.at(-1).cpuPercent, 17.5);
    assert.equal(result.points.at(-1).memoryPercent, 0);
    assert.equal(result.points.at(-2).cpuPercent, null);
    assert.equal(result.points.at(-1).rxBytesPerSecond, null);
  }
});

test("three-second history keeps individual host observations and a missing fast tick separate", () => {
  const result = buildMonitorHistoryPoints([
    { collectedAt: new Date(now - 9000), cpuPercent: 10 },
    { collectedAt: new Date(now - 3000), cpuPercent: 80, rxBytesPerSecond: 0 },
    { collectedAt: new Date(now), cpuPercent: null },
  ], "1h", now);
  assert.deepEqual(result.points.slice(-4).map((point) => point.cpuPercent), [10, null, 80, null]);
  assert.equal(result.points.at(-2).rxBytesPerSecond, 0);
  assert.equal(result.points.at(-3).rxBytesPerSecond, null);
});

test("body reader enforces actual streamed size, content type and valid JSON", async () => {
  const request = (body, headers = { "content-type": "application/json" }) => new Request("http://127.0.0.1:3000/api/monitor/ingest", { method: "POST", headers, body });
  assert.deepEqual(await readMonitorJsonBody(request('{"samples":[]}')), { samples: [] });
  await assert.rejects(readMonitorJsonBody(request("{")), /invalid_json/);
  await assert.rejects(readMonitorJsonBody(request("{}", { "content-type": "text/plain" })), /invalid_content_type/);
  await assert.rejects(readMonitorJsonBody(request(" ".repeat(MONITOR_MAX_BODY_BYTES + 1))), /payload_too_large/);
});
