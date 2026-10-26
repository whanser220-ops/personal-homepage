import { readMonitorSession } from "../../../../../src/server/monitorAuth.js";
import { readMonitorSignalsHistory } from "../../../../../src/server/monitorData.js";
import { logMonitorReadFailure, monitorJson } from "../../../../../src/server/monitorHttp.js";
import { validMonitorSignalService } from "../../../../../src/server/monitorSignals.js";
import { MONITOR_HISTORY_RANGES } from "../../../../../src/server/monitorValidation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    if (!await readMonitorSession(request)) return monitorJson({ error: "unauthorized" }, 401);
    const params = new URL(request.url).searchParams;
    const service = params.get("service") ?? "all", range = params.get("range") ?? "1h";
    if (!validMonitorSignalService(service)) return monitorJson({ error: "invalid_service" }, 400);
    if (!Object.hasOwn(MONITOR_HISTORY_RANGES, range)) return monitorJson({ error: "invalid_range" }, 400);
    return monitorJson(await readMonitorSignalsHistory(service, range));
  } catch (error) { logMonitorReadFailure("signals_history", error); return monitorJson({ error: "monitor_unavailable" }, 503); }
}
