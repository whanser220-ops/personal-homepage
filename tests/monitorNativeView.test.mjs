import assert from "node:assert/strict";
import test from "node:test";
import { chartGeometry, bytesLabel, effectiveContainer, effectiveService, historyResolution, monitorFreshness, monitorTime, monitorViewHash, numberLabel, parseMonitorView, signalMessage } from "../src/components/monitorView.js";
import { createMonitorPoller } from "../src/components/monitorPolling.js";

test("native navigation keeps valid old links and rejects destinations outside its allowlists", () => {
  assert.deepEqual(parseMonitorView("#monitor-history?range=7d&service=study-agent"), { view: "trends", range: "7d", service: "study-agent" });
  assert.deepEqual(parseMonitorView("#https://attacker/?range=8h&service=../../auth"), { view: "overview", range: "1h", service: "all" });
  for (const range of ["1h", "24h", "7d"]) assert.deepEqual(parseMonitorView(monitorViewHash({ view: "trends", range, service: "website" })), { view: "trends", range, service: "website" });
});

test("null, zero and finite measurements remain distinct in labels and plot geometry", () => {
  assert.equal(numberLabel(null), "—"); assert.equal(numberLabel(0), "0.0"); assert.equal(bytesLabel(0, true), "0 B/s"); assert.equal(bytesLabel(null), "—");
  const points = [0, null, 20, 0].map((value, index) => ({ collectedAt: new Date(10000 + index * 3000).toISOString(), value }));
  const geometry = chartGeometry(points, ["value"], { max: 100 });
  assert.equal(geometry.hasData, true); assert.equal(geometry.series[0].segments.length, 2);
  assert.deepEqual(geometry.series[0].segments.map((part) => part.map((point) => point.value)), [[0], [20, 0]]);
  assert.equal((geometry.series[0].path.match(/M/g) || []).length, 2);
  assert.equal(geometry.series[0].segments[0][0].y, geometry.base);
  assert.equal(geometry.y(100), geometry.top);
  assert.equal(chartGeometry([{ collectedAt: "invalid", value: 90 }], ["value"]).hasData, false);
  assert.equal(chartGeometry(points.map((point) => ({ ...point, value: null })), ["value"]).hasData, false);
});

test("all three real history sizes preserve interior/trailing outages per series without interpolation", () => {
  for (const [count, interval] of [[1201, 3], [289, 300], [337, 1800]]) {
    const points = Array.from({ length: count }, (_, index) => ({ collectedAt: new Date(1000000000 + index * interval * 1000).toISOString(), cpu: index > 20 && index < 30 || index > count - 5 ? null : index % 100, memory: index === 4 ? null : 50 }));
    const geometry = chartGeometry(points, ["cpu", "memory"], { max: 100 });
    assert.equal(geometry.series[0].segments.length, 2);
    assert.equal(geometry.series[1].segments.length, 2);
    assert.equal(geometry.series[0].segments.at(-1).at(-1).index, count - 5);
    assert.equal(geometry.x(Date.parse(points[0].collectedAt)), geometry.left);
    assert.equal(geometry.x(Date.parse(points.at(-1).collectedAt)), geometry.right);
    assert.equal(points[21].cpu, null);
    assert.ok(!geometry.series[0].path.includes("NaN"));
  }
});

test("three-second samples have distinguishable exact readouts while compact axes and responsive geometry stay valid", () => {
  assert.equal(historyResolution(3), "3 秒/点"); assert.equal(historyResolution(300), "5 分钟/点"); assert.equal(historyResolution(1800), "30 分钟/点"); assert.equal(historyResolution(null), null);
  const a = "2026-10-26T12:00:03Z", b = "2026-10-26T12:00:06Z";
  assert.notEqual(monitorTime(a, true, true), monitorTime(b, true, true));
  assert.equal(monitorTime(a, true), monitorTime(b, true));
  assert.match(monitorTime(a, true, true), /:03$/);
  const points = [{ collectedAt: a, cpu: 0 }, { collectedAt: b, cpu: 100 }];
  const narrow = chartGeometry(points, ["cpu"], { width: 333, max: 100 });
  assert.equal(narrow.width, 333); assert.equal(narrow.right, 315);
  assert.equal(narrow.series[0].segments[0][1].x, 315);
});

test("independent 45s and 9s freshness and service checks do not call a redirect/function equivalence", () => {
  const now = Date.parse("2026-10-26T12:00:00Z"), at = new Date(now - 12000).toISOString();
  assert.equal(monitorFreshness(at, now, false, 45).stale, false);
  assert.equal(monitorFreshness(at, now, false, 9).stale, true);
  assert.equal(monitorFreshness(new Date(now - 45000).toISOString(), now).stale, false);
  assert.equal(monitorFreshness(new Date(now - 45001).toISOString(), now).stale, true);
  assert.equal(monitorFreshness(new Date(now - 9001).toISOString(), now, false, 9).stale, true);
  assert.equal(monitorFreshness(new Date(now - 9000).toISOString(), now, false, 9, true).stale, true);
  assert.equal(monitorFreshness(null, now).stale, true);
  const service = { kind: "http", status: "reachable", httpStatus: 303 };
  assert.equal(effectiveService(service, false).label, "可达");
  assert.equal(effectiveService(service, true).status, "unknown");
  assert.equal(effectiveService({ kind: "tcp", status: "reachable" }, false).kindLabel, "端口可达");
  assert.match(signalMessage({ trafficState: "no_traffic" }, false), /没有请求/);
  assert.match(signalMessage({ trafficState: "no_data" }, false), /尚无请求样本/);
  assert.match(signalMessage({ trafficState: "observed" }, true), /未更新/);
});

test("container labels distinguish missing state, no health check, start-up, failure, and multi-core CPU", () => {
  const running = effectiveContainer({ state: "running", health: "none", cpuPercent: 125 }, false);
  assert.equal(running.stateLabel, "运行中"); assert.equal(running.healthLabel, "未配置健康检查"); assert.equal(running.cpuPercent, 125);
  assert.equal(effectiveContainer({ state: "unknown", health: "unknown" }, false).stateStatus, "unknown");
  assert.equal(effectiveContainer({}, false).stateStatus, "unknown");
  assert.equal(effectiveContainer({}, false).healthLabel, "未知");
  assert.equal(effectiveContainer({ state: "exited", health: "unhealthy" }, false).stateStatus, "unhealthy");
  assert.equal(effectiveContainer({ state: "running", health: "starting" }, false).healthLabel, "启动检查中");
  const stale = effectiveContainer({ state: "running", health: "healthy" }, true);
  assert.equal(stale.stateStatus, "unknown"); assert.equal(stale.healthLabel, "未知");
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function clock() {
  let timeout, interval;
  return { setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() { timeout = null; }, setInterval(fn) { interval = fn; return 2; }, clearInterval() { interval = null; }, tick() { return interval?.(); }, expire() { timeout?.(); }, get active() { return Boolean(interval); } };
}

test("polling has one in-flight request, skips hidden tabs and refreshes immediately on return", async () => {
  const timers = clock(), first = deferred(), data = []; let visible = true, calls = 0;
  const poller = createMonitorPoller({ url: "/api/monitor/current", intervalMs: 3000, timers, isVisible: () => visible,
    fetchImpl: async () => { calls++; return calls === 1 ? first.promise : { ok: true, json: async () => ({ value: calls }) }; }, onData: (value) => data.push(value), onError: assert.fail, onUnauthorized: assert.fail });
  await timers.tick(); await poller.refresh(); assert.equal(calls, 1);
  first.resolve({ ok: true, json: async () => ({ value: 1 }) }); await flush(); assert.equal(data.length, 1);
  visible = false; await timers.tick(); await poller.refresh(); assert.equal(calls, 1);
  visible = true; await poller.refresh(); assert.equal(calls, 2); assert.deepEqual(data.at(-1), { value: 2 });
  poller.stop(); assert.equal(timers.active, false);
});

test("401 stops polling and late JSON after unmount cannot restore private data", async () => {
  const timers = clock(); let unauthorized = 0, calls = 0;
  createMonitorPoller({ url: "/api/monitor/signals/current", intervalMs: 3000, timers, fetchImpl: async () => { calls++; return { status: 401 }; }, onData: assert.fail, onError: assert.fail, onUnauthorized: () => unauthorized++ });
  await flush(); await timers.tick(); assert.equal(unauthorized, 1); assert.equal(calls, 1); assert.equal(timers.active, false);
  const payload = deferred(), secondClock = clock(); let publish = 0, aborted = false;
  const poller = createMonitorPoller({ url: "/private", intervalMs: 3000, timers: secondClock, fetchImpl: async (_, options) => { options.signal.addEventListener("abort", () => { aborted = true; }); return { ok: true, json: () => payload.promise }; }, onData: () => publish++, onError: assert.fail, onUnauthorized: assert.fail });
  await flush(); poller.stop(); payload.resolve({ private: true }); await flush();
  assert.equal(publish, 0); assert.equal(aborted, true); assert.equal(secondClock.active, false);
});

test("deadline abort releases the nonoverlap lock, reports a concise error, and recovers next tick", async () => {
  const timers = clock(), errors = [], values = []; let calls = 0;
  const poller = createMonitorPoller({ url: "/private", intervalMs: 3000, timers, fetchImpl: async (_, options) => {
    calls++; if (calls > 1) return { ok: true, json: async () => ({ recovered: true }) };
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("deadline", "AbortError"))));
  }, onData: (value) => values.push(value), onError: (error) => errors.push(error), onUnauthorized: assert.fail });
  timers.expire(); await flush(); assert.equal(errors.length, 1); assert.match(errors[0], /超时/);
  await timers.tick(); assert.deepEqual(values, [{ recovered: true }]); poller.stop();
});
