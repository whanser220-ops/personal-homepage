import { MONITOR_MAX_BODY_BYTES, MonitorValidationError } from "./monitorValidation.js";

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
