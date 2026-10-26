import assert from "node:assert/strict";
import test from "node:test";
import { MONITOR_GRAFANA_VIEWS, monitorGrafanaHash, monitorGrafanaLoadTransition, monitorGrafanaUrl, parseMonitorGrafanaHash } from "../src/components/monitorGrafanaView.js";

test("the Grafana main views keep the agreed UIDs and separate live/history refresh cadence", () => {
  for (const board of MONITOR_GRAFANA_VIEWS) {
    const url = new URL(monitorGrafanaUrl(board.id, "24h", "light"), "https://warmhanser.com");
    assert.equal(url.pathname, `/server-monitor/grafana/d/${board.uid}/${board.id}`);
    assert.equal(url.searchParams.get("refresh"), board.id === "overview" ? "3s" : "30s");
    assert.equal(url.searchParams.get("theme"), "light");
    assert.equal(url.searchParams.get("from"), "now-24h");
    assert.equal(url.searchParams.get("to"), "now");
    assert.equal(url.searchParams.get("kiosk"), "tv");
  }
});

test("all quick ranges round trip in navigation state and legacy links still select useful views", () => {
  for (const board of MONITOR_GRAFANA_VIEWS) for (const range of ["1h", "24h", "7d"]) {
    assert.deepEqual(parseMonitorGrafanaHash(monitorGrafanaHash(board.id, range)), { view: board.id, range });
    assert.equal(new URL(monitorGrafanaUrl(board.id, range, "dark"), "https://warmhanser.com").searchParams.get("from"), `now-${range}`);
    assert.equal(new URL(monitorGrafanaUrl(board.id, range, "dark"), "https://warmhanser.com").searchParams.get("var-resolution"), ({ "1h": "3s", "24h": "5m", "7d": "30m" })[range]);
  }
  assert.equal(parseMonitorGrafanaHash("#monitor-history").view, "trends");
  assert.equal(parseMonitorGrafanaHash("#monitor-containers").view, "infrastructure");
});

test("untrusted hash state cannot change the same-origin destination, theme or refresh target", () => {
  assert.deepEqual(parseMonitorGrafanaHash("#https://evil.invalid?range=999d"), { view: "overview", range: "1h" });
  const url = new URL(monitorGrafanaUrl("//evil.invalid", "7d&refresh=1ms", "dark&orgId=2", false), "https://warmhanser.com");
  assert.equal(url.origin, "https://warmhanser.com");
  assert.equal(url.searchParams.get("from"), "now-1h");
  assert.equal(url.searchParams.get("theme"), "dark");
  assert.equal(url.searchParams.get("refresh"), "3s");
  assert.equal(url.searchParams.get("orgId"), "1");
  assert.equal(url.searchParams.has("kiosk"), false);
});

test("a slow cold bootstrap remains in progress and recovers on the actual load event", () => {
  let state = monitorGrafanaLoadTransition("checking", "start");
  assert.equal(state, "loading");
  state = monitorGrafanaLoadTransition(state, "slow");
  assert.equal(state, "slow");
  assert.notEqual(state, "error");
  state = monitorGrafanaLoadTransition(state, "slow");
  assert.equal(state, "slow");
  state = monitorGrafanaLoadTransition(state, "loaded");
  assert.equal(state, "ready");
  assert.equal(monitorGrafanaLoadTransition(state, "slow"), "ready");
});

test("only real failures enter the retry state and a late timer cannot mask that failure", () => {
  let state = monitorGrafanaLoadTransition("loading", "failed");
  assert.equal(state, "error");
  assert.equal(monitorGrafanaLoadTransition(state, "slow"), "error");
  state = monitorGrafanaLoadTransition(state, "start");
  assert.equal(state, "loading");
  assert.equal(monitorGrafanaLoadTransition(state, "loaded"), "ready");
});
