// Executes against the actual compiled Next HTTP routes inside the candidate.
const base = "http://127.0.0.1:3000";
const ownerCookie = "__Host-server-monitor-session=" + "r".repeat(43);
const fields = ["cpuPercent", "memoryPercent", "swapPercent", "diskPercent", "diskReadBytesPerSecond", "diskWriteBytesPerSecond", "rxBytesPerSecond", "txBytesPerSecond"];
const signalFields = ["requestsPerSecond", "serverErrorPercent", "clientErrorPercent", "successP95Ms", "successP99Ms", "failureP95Ms", "failureP99Ms", "responseBytesPerSecond"];
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
  for (const cookie of [undefined, ownerCookie]) {
    const response = await request("/api/monitor/auth/grafana", cookie);
    requireCondition(response.status === 404 && !response.headers.has("x-monitor-user"), "runtime_retired_auth_route_open");
  }
  const page = await request("/server-monitor");
  requireCondition(page.status === 200, "runtime_custom_page_unavailable");
  const pageHtml = await page.text();
  requireCondition(!pageHtml.includes("<iframe") && !pageHtml.includes("/server-monitor/grafana/"), "runtime_custom_page_embeds_retired_dashboard");
  let current;
  const standard = process.env.MONITOR_EXPORTER_MODE === "standard";
  const attempts = standard ? 40 : 7;
  const cutoff = Date.parse(process.env.MONITOR_PROMETHEUS_CUTOVER_AT);
  for (let attempt = 0; attempt < attempts; attempt++) {
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
    const host = current.sample.host;
    const allHostRatesReady = !standard || [host.network?.txBytesPerSecond, host.disk?.readBytesPerSecond,
      host.disk?.writeBytesPerSecond, host.memory?.usedPercent, host.swap?.usedPercent, host.disk?.usedPercent].every(Number.isFinite);
    const resourcesReady = !standard || current.sample.containers.every((container) => container.state === "running" &&
      typeof container.image === "string" && container.image.length > 0 && Number.isInteger(container.restartCount) && container.restartCount >= 0 &&
      Number.isFinite(container.cpuPercent) && container.cpuPercent >= 0 && Number.isFinite(container.memoryBytes) && container.memoryBytes > 0 &&
      Number.isFinite(container.memoryLimitBytes) && container.memoryLimitBytes > 0 && Number.isFinite(container.memoryPercent));
    if (standard) {
      requireCondition(current.sample.services.every((service) => {
        if (service.kind === "process") return service.status === "healthy";
        if (service.kind === "tcp") return service.status === "reachable";
        const code = service.httpStatus;
        return Number.isInteger(code) && (code >= 200 && code < 300 ? service.status === "healthy" :
          ((code >= 300 && code < 400) || code === 401 || code === 403) && service.status === "reachable");
      }), "runtime_service_health_or_semantics_invalid");
    }
    if (hostTime >= cutoff && ratesReady && allHostRatesReady && resourcesReady) break;
    requireCondition(attempt < attempts - 1, !resourcesReady ? "runtime_container_resources_missing" :
      !ratesReady || !allHostRatesReady ? "runtime_host_rates_missing" : "runtime_post_cutover_sample_missing");
    await delay(1000);
  }
  const history = {};
  const signals = {};
  for (const path of ["/api/monitor/signals/current?service=invalid", "/api/monitor/signals/history?range=invalid"]) {
    for (const cookie of [undefined, "__Host-server-monitor-session=" + "z".repeat(43), ownerCookie]) {
      const response = await request(path, cookie);
      requireCondition(response.status === (cookie === ownerCookie ? 400 : 401), "runtime_signals_auth_order_invalid");
      privateResponse(response);
    }
  }
  for (const service of ["all", "website", "whiteboard", "study-agent"]) {
    const response = await request("/api/monitor/signals/current?service=" + service, ownerCookie);
    requireCondition(response.status === 200, "runtime_signals_current_http_" + response.status);
    privateResponse(response);
    const data = await response.json();
    requireCondition(data.service === service && data.stale === false && data.staleAfterSeconds === 9 &&
      data.exporterUp === true && data.parseErrorsTotal === 0 && Number.isFinite(Date.parse(data.collectedAt)) &&
      Number.isFinite(Date.parse(data.recordedAt)) && Date.now() - Date.parse(data.collectedAt) <= 9000 &&
      Date.now() - Date.parse(data.recordedAt) <= 9000 &&
      ["no_data", "no_traffic", "observed"].includes(data.trafficState) &&
      signalFields.every((field) => data.metrics?.[field] === null || Number.isFinite(data.metrics?.[field])),
      "runtime_signals_current_contract_invalid");
    signals[service] = { status: response.status, trafficState: data.trafficState };
  }
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
    const signalAnonymous = await request("/api/monitor/signals/history?range=" + range);
    requireCondition(signalAnonymous.status === 401, "runtime_signals_history_anonymous");
    privateResponse(signalAnonymous);
    const signalResponse = await request("/api/monitor/signals/history?range=" + range, ownerCookie);
    requireCondition(signalResponse.status === 200, "runtime_signals_history_" + range + "_http_" + signalResponse.status);
    privateResponse(signalResponse);
    const signalData = await signalResponse.json();
    requireCondition(signalData.range === range && signalData.points?.length === count &&
      signalData.points.every((point) => Number.isFinite(Date.parse(point.collectedAt)) &&
        signalFields.every((field) => point[field] === null || Number.isFinite(point[field]))),
      "runtime_signals_history_" + range + "_invalid_points");
  }
  console.log(JSON.stringify({ test: "compiled-next-runtime", anonymous: 401, wrongSession: 401,
    current: 200, retiredAuthorization: 404, customPage: 200, signals,
    exporterMode: standard ? "standard" : "legacy", containers: 3, services: 11, history }));
} catch (error) {
  console.error(/^runtime_[A-Za-z0-9_]+$/.test(error.message || "") ? error.message : "runtime_probe_failed_" + error.name);
  process.exitCode = 1;
}
