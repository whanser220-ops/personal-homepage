import { clearMonitorOAuthCookie, deleteMonitorSession, isMonitorSameOrigin, MONITOR_SESSION_COOKIE, setMonitorCookie } from "../../../../../src/server/monitorAuth.js";
import { monitorJson } from "../../../../../src/server/monitorHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isMonitorSameOrigin(request)) return monitorJson({ error: "invalid_origin" }, 403);
  try {
    await deleteMonitorSession(request);
    return clearMonitorOAuthCookie(setMonitorCookie(monitorJson({ ok: true }), MONITOR_SESSION_COOKIE, "", 0));
  } catch { return monitorJson({ error: "logout_unavailable" }, 503); }
}
