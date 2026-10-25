import { readMonitorSession } from "../../../../../src/server/monitorAuth.js";
import { monitorJson } from "../../../../../src/server/monitorHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nginx auth_request consumes only this response status and this header. The
// identity comes from the existing database session, never a proxy header.
const OWNER = "whanser220@gmail.com";

export async function GET(request) {
  try {
    const session = await readMonitorSession(request);
    if (!session || session.email !== OWNER) return monitorJson({ error: "unauthorized" }, 401);
    return new Response(null, { status: 204, headers: {
      "X-Monitor-User": OWNER,
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    } });
  } catch {
    return monitorJson({ error: "monitor_unavailable" }, 503);
  }
}
