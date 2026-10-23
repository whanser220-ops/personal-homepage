import { readMonitorSession } from "../../../../src/server/monitorAuth.js";
import { readCurrentMonitorSample } from "../../../../src/server/monitorDb.js";
import { monitorJson } from "../../../../src/server/monitorHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    if (!await readMonitorSession(request)) return monitorJson({ error: "unauthorized" }, 401);
    return monitorJson(await readCurrentMonitorSample());
  } catch { return monitorJson({ error: "monitor_unavailable" }, 503); }
}
