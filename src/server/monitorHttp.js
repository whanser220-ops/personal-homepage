import { MONITOR_MAX_BODY_BYTES, MonitorValidationError } from "./monitorValidation.js";

const failureLogTimes = new Map();
const safeFailureMessages = new Set([
  "invalid_monitor_data_backend", "invalid_monitor_prometheus_url", "invalid_monitor_prometheus_cutover",
  "prometheus_unavailable", "prometheus_response_too_large", "invalid_prometheus_response",
  "ambiguous_prometheus_series", "monitor_not_configured", "invalid_range",
]);

export function logMonitorReadFailure(operation, error, now = Date.now()) {
  if (!["current", "history"].includes(operation)) return;
  const previous = failureLogTimes.get(operation);
  if (previous !== undefined && now - previous < 30_000) return;
  failureLogTimes.set(operation, now);
  const name = ["Error", "TypeError", "RangeError", "AbortError", "TimeoutError"].includes(error?.name) ? error.name : "Error";
  const message = safeFailureMessages.has(error?.message) ? error.message : "unknown";
  const code = /^(?:E[A-Z_]{2,40}|[0-9A-Z]{5}|ABORT_ERR)$/.test(error?.code || "") ? error.code : "unknown";
  // Keep only static locations in our compiled server. Never log an error's
  // free-form message, query, HTTP headers, session token, or connection URL.
  const location = typeof error?.stack === "string"
    ? error.stack.match(/\/app\/\.next\/server\/[A-Za-z0-9_./\[\]%-]+\.js:\d+:\d+/)?.[0] || null : null;
  console.error("Monitor read failed", { operation, name, message, code, location });
}

export function monitorJson(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store, private", "Pragma": "no-cache",
    "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}

export function monitorRedirect(location) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer", "Vary": "Cookie" } });
}

export async function readMonitorJsonBody(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new MonitorValidationError("invalid_content_type");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > MONITOR_MAX_BODY_BYTES) throw new MonitorValidationError("payload_too_large");
  if (!request.body) throw new MonitorValidationError("invalid_json");
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MONITOR_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new MonitorValidationError("payload_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new MonitorValidationError("invalid_json"); }
}
