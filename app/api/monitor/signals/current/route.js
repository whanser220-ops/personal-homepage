import { readMonitorSession } from "../../../../../src/server/monitorAuth.js";
import { readMonitorSignalsCurrent } from "../../../../../src/server/monitorData.js";
import { logMonitorReadFailure, monitorJson } from "../../../../../src/server/monitorHttp.js";
import { validMonitorSignalService } from "../../../../../src/server/monitorSignals.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    if (!await readMonitorSession(request)) return monitorJson({ error: "unauthorized" }, 401);
    const service = new URL(request.url).searchParams.get("service") ?? "all";
    if (!validMonitorSignalService(service)) return monitorJson({ error: "invalid_service" }, 400);
    return monitorJson(await readMonitorSignalsCurrent(service));
  } catch (error) { logMonitorReadFailure("signals_current", error); return monitorJson({ error: "monitor_unavailable" }, 503); }
}
