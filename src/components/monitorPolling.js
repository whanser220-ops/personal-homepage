// One bounded request at a time. Stopped or hidden consumers cannot publish a
// delayed response, and authentication failure terminates this poller.
export function createMonitorPoller({ url, intervalMs, timeoutMs = 10000, onData, onError, onUnauthorized, isVisible = () => true, fetchImpl = fetch, timers = globalThis }) {
  let stopped = false, busy = false, controller, deadline, interval;
  async function refresh() {
    if (stopped || busy || !isVisible()) return;
    busy = true; controller = new AbortController();
    deadline = timers.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (stopped) return;
      if (response.status === 401) { stop(); onUnauthorized(); return; }
      if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`);
      const value = await response.json();
      if (!stopped && isVisible()) onData(value);
    } catch (error) {
      if (!stopped && isVisible()) onError(error.name === "AbortError" ? "读取超时，稍后自动重试。" : error.message || "暂时无法读取，稍后自动重试。");
    } finally { timers.clearTimeout(deadline); busy = false; }
  }
  function stop() { stopped = true; timers.clearInterval(interval); timers.clearTimeout(deadline); controller?.abort(); }
  interval = timers.setInterval(refresh, intervalMs);
  refresh();
  return { refresh, stop };
}
