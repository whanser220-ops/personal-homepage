import { isMonitorAuthConfigured, readMonitorSession } from "../../../../../src/server/monitorAuth.js";
import { monitorJson } from "../../../../../src/server/monitorHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const session = await readMonitorSession(request);
    return monitorJson({ authenticated: Boolean(session), configured: isMonitorAuthConfigured(), ...(session ? { email: session.email } : {}) });
  } catch { return monitorJson({ authenticated: false, configured: isMonitorAuthConfigured(), error: "monitor_unavailable" }, 503); }
}
