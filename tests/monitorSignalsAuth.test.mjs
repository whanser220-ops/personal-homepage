import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { GET as current } from "../app/api/monitor/signals/current/route.js";
import { GET as history } from "../app/api/monitor/signals/history/route.js";
import { hashMonitorToken, MONITOR_SESSION_COOKIE } from "../src/server/monitorAuth.js";

const OWNER = "whanser220@gmail.com", TOKEN = "a".repeat(43);
function harness(t) {
  const previous = globalThis.__personalHomepageMonitorDb;
  const keys = ["DATABASE_URL", "MONITOR_OWNER_EMAIL", "MONITOR_DATA_BACKEND", "MONITOR_PROMETHEUS_URL"];
  const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { DATABASE_URL: "postgresql://fixture.invalid/monitor", MONITOR_OWNER_EMAIL: OWNER,
    MONITOR_DATA_BACKEND: "prometheus", MONITOR_PROMETHEUS_URL: "http://8.8.8.8:19090" });
  const sessions = new Map(); let reads = 0;
  globalThis.__personalHomepageMonitorDb = { schema: Promise.resolve(), timer: {}, cleanupAt: Infinity, pool: { query: async (sql, params) => {
    assert.match(sql, /^select subject, email, expires_at/);
    reads++;
    return { rows: sessions.has(params[0]) ? [sessions.get(params[0])] : [] };
  } } };
  t.after(() => {
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    if (previous === undefined) delete globalThis.__personalHomepageMonitorDb; else globalThis.__personalHomepageMonitorDb = previous;
  });
  return { sessions, get reads() { return reads; } };
}
const cookie = (token) => token ? `${MONITOR_SESSION_COOKIE}=${token}` : "";
function noCache(response) {
  assert.equal(response.headers.get("Cache-Control"), "no-store, private");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(response.headers.get("Vary"), "Cookie");
}

test("signals routes authorize the existing owner session before parameters or metric reads", async (t) => {
  const fixture = harness(t);
  fixture.sessions.set(hashMonitorToken("e".repeat(43)), { subject: "owner", email: OWNER, expires_at: new Date(Date.now() - 1) });
  fixture.sessions.set(hashMonitorToken("w".repeat(43)), { subject: "other", email: "other@gmail.com", expires_at: new Date(Date.now() + 60_000) });
  for (const route of [current, history]) for (const token of ["", "forged", "e".repeat(43), "w".repeat(43)]) {
    const response = await route(new Request("https://warmhanser.com/api/monitor/signals/current?service=invalid&range=bad", {
      headers: { cookie: cookie(token), "X-Monitor-User": OWNER, "X-WEBAUTH-USER": OWNER },
    }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    noCache(response);
  }
});

test("authenticated invalid services and ranges fail without exposing or accessing a PromQL target", async (t) => {
  const fixture = harness(t);
  fixture.sessions.set(hashMonitorToken(TOKEN), { subject: "owner", email: OWNER, expires_at: new Date(Date.now() + 60_000) });
  for (const [route, query, error] of [[current, "service=unknown", "invalid_service"], [history, "service=unknown", "invalid_service"],
    [current, "service=", "invalid_service"], [history, "service=all&range=", "invalid_range"],
    [history, "service=all&range=30d", "invalid_range"], [current, 'service=website%22%7D%20or%20vector(1)', "invalid_service"]]) {
    const response = await route(new Request("https://warmhanser.com/api/monitor/signals/current?" + query, { headers: { cookie: cookie(TOKEN) } }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error });
    noCache(response);
  }
});

test("owner backend failures remain 503 no-store and never fall back to private PostgreSQL history", async (t) => {
  const fixture = harness(t);
  fixture.sessions.set(hashMonitorToken(TOKEN), { subject: "owner", email: OWNER, expires_at: new Date(Date.now() + 60_000) });
  for (const route of [current, history]) {
    const response = await route(new Request("https://warmhanser.com/api/monitor/signals/current", { headers: { cookie: cookie(TOKEN) } }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "monitor_unavailable" });
    noCache(response);
  }
  assert.equal(fixture.reads, 2, "only the two Google database session reads are permitted");
});

test("actual owner GETs keep current and all history response shapes and one bounded Prometheus call", async (t) => {
  const fixture = harness(t);
  fixture.sessions.set(hashMonitorToken(TOKEN), { subject: "owner", email: OWNER, expires_at: new Date(Date.now() + 60_000) });
  let calls = 0;
  const server = http.createServer((request, response) => {
    calls++;
    const url = new URL(request.url, "http://127.0.0.1:19095"), now = Number(url.searchParams.get("time")) || Date.now() / 1000;
    assert.ok(url.searchParams.get("query").includes('monitor_field'));
    const metadata = { captureSeconds: now - 1, recordedSeconds: now - .5, exporterValue: 1, exporterSeconds: now - 1,
      exporterSeries: 1, markerSeries: 1, parseErrorsTotal: 0, requestsPerSecond: 2, serverErrorPercent: 0, clientErrorPercent: 0,
      successP95Ms: 20, successP99Ms: 25, responseBytesPerSecond: 100 };
    const data = url.pathname.endsWith("query_range")
      ? { resultType: "matrix", result: [{ metric: { monitor_field: "requestsPerSecond" }, values: [[Number(url.searchParams.get("end")), "2"]] }] }
      : { resultType: "vector", result: Object.entries(metadata).map(([field, value]) => ({ metric: { monitor_field: field }, value: [now, String(value)] })) };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "success", data }));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(19095, "127.0.0.1", resolve); });
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  process.env.MONITOR_PROMETHEUS_URL = "http://127.0.0.1:19095";
  let response = await current(new Request("https://warmhanser.com/api/monitor/signals/current?service=website", { headers: { cookie: cookie(TOKEN) } }));
  assert.equal(response.status, 200);
  noCache(response);
  const snapshot = await response.json();
  assert.equal(snapshot.service, "website");
  assert.equal(snapshot.trafficState, "observed");
  assert.equal(snapshot.metrics.requestsPerSecond, 2);
  assert.equal(snapshot.metrics.failureP95Ms, null);
  for (const [range, count] of [["1h", 1201], ["24h", 289], ["7d", 337]]) {
    response = await history(new Request(`https://warmhanser.com/api/monitor/signals/history?service=all&range=${range}`, { headers: { cookie: cookie(TOKEN) } }));
    assert.equal(response.status, 200);
    noCache(response);
    const body = await response.json();
    assert.equal(body.range, range);
    assert.equal(body.points.length, count);
    assert.equal(body.points.at(-1).requestsPerSecond, 2);
    assert.equal(body.points[0].requestsPerSecond, null);
  }
  assert.equal(calls, 4);
  assert.equal(fixture.reads, 4);
});
