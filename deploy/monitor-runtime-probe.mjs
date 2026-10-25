// Executes against the actual compiled Next HTTP routes inside the candidate.
const base = "http://127.0.0.1:3000";
const ownerCookie = "__Host-server-monitor-session=" + "r".repeat(43);
const fields = ["cpuPercent", "memoryPercent", "swapPercent", "diskPercent", "diskReadBytesPerSecond", "diskWriteBytesPerSecond", "rxBytesPerSecond", "txBytesPerSecond"];
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function requireCondition(condition, code) { if (!condition) throw new Error(code); }
async function request(path, cookie) {
  return fetch(base + path, { headers: cookie ? { Cookie: cookie } : {}, signal: AbortSignal.timeout(12_000) });
}
function privateResponse(response) {
  requireCondition(response.headers.get("cache-control")?.includes("no-store"), "runtime_cache_control_missing");
}

try {
  requireCondition(process.env.MONITOR_RUNTIME_PROBE === "1" && process.env.HOSTNAME === "127.0.0.1", "runtime_probe_environment_rejected");
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(base + "/api/monitor/current", { signal: AbortSignal.timeout(1000) });
      if (response.status === 401) { privateResponse(response); ready = true; break; }
      throw new Error("runtime_anonymous_http_" + response.status);
    } catch (error) {
      if (String(error.message).startsWith("runtime_")) throw error;
      if (attempt === 29) throw new Error("runtime_server_start_timeout");
      await delay(1000);
    }
  }
  requireCondition(ready, "runtime_server_not_ready");
  const wrong = await request("/api/monitor/current", "__Host-server-monitor-session=" + "z".repeat(43));
  requireCondition(wrong.status === 401, "runtime_wrong_session_rejected");
  privateResponse(wrong);
  let current;
  const cutoff = Date.parse(process.env.MONITOR_PROMETHEUS_CUTOVER_AT);
  for (let attempt = 0; attempt < 7; attempt++) {
    const response = await request("/api/monitor/current", ownerCookie);
    requireCondition(response.status === 200, "runtime_current_http_" + response.status);
    privateResponse(response);
    current = await response.json();
    requireCondition(current.stale === false && current.checksStale === false && current.sample, "runtime_current_stale");
    const now = Date.now(), hostTime = Date.parse(current.sample.collectedAt), checksTime = Date.parse(current.sample.checksCollectedAt);
    requireCondition(Number.isFinite(hostTime) && Number.isFinite(checksTime) && now - hostTime >= -5000 && now - checksTime >= -5000 && now - hostTime <= 45_000 && now - checksTime <= 45_000, "runtime_timestamps_stale");
    requireCondition(current.sample.hostId === "cloud-primary" && current.sample.host?.memory?.totalBytes > 0, "runtime_host_metrics_missing");
    requireCondition(current.sample.containers?.length === 3 && current.sample.services?.length === 11, "runtime_inventory_counts_invalid");
    const ratesReady = Number.isFinite(current.sample.host?.cpu?.percent) && Number.isFinite(current.sample.host?.network?.rxBytesPerSecond);
    if (hostTime >= cutoff && ratesReady) break;
    requireCondition(attempt < 6, ratesReady ? "runtime_post_cutover_sample_missing" : "runtime_host_rates_missing");
    await delay(1000);
  }
  const history = {};
  for (const [range, count] of [["1h", 1201], ["24h", 289], ["7d", 337]]) {
    const anonymous = await request("/api/monitor/history?range=" + range);
    requireCondition(anonymous.status === 401, "runtime_history_anonymous_http_" + anonymous.status);
    privateResponse(anonymous);
    const response = await request("/api/monitor/history?range=" + range, ownerCookie);
    requireCondition(response.status === 200, "runtime_history_" + range + "_http_" + response.status);
    privateResponse(response);
    const data = await response.json();
    requireCondition(data.range === range && data.points?.length === count, "runtime_history_" + range + "_point_count");
    requireCondition(data.points.every((point) => Number.isFinite(Date.parse(point.collectedAt)) &&
      fields.every((field) => point[field] === null || Number.isFinite(point[field]))), "runtime_history_" + range + "_invalid_points");
    const populated = data.points.filter((point) => Number.isFinite(point.memoryPercent)).length;
    requireCondition(populated > 0, "runtime_history_" + range + "_empty");
    requireCondition(data.points[0].memoryPercent === null, "runtime_history_" + range + "_fabricated_history");
    history[range] = { status: response.status, points: count, populated };
  }
  console.log(JSON.stringify({ test: "compiled-next-runtime", anonymous: 401, wrongSession: 401,
    current: 200, containers: 3, services: 11, history }));
} catch (error) {
  console.error(/^runtime_[A-Za-z0-9_]+$/.test(error.message || "") ? error.message : "runtime_probe_failed_" + error.name);
  process.exitCode = 1;
}
