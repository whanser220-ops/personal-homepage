import { readMonitorSession } from "../../../../src/server/monitorAuth.js";
import { readMonitorHistory } from "../../../../src/server/monitorData.js";
import { monitorJson } from "../../../../src/server/monitorHttp.js";
import { MONITOR_HISTORY_RANGES } from "../../../../src/server/monitorValidation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    if (!await readMonitorSession(request)) return monitorJson({ error: "unauthorized" }, 401);
    const range = new URL(request.url).searchParams.get("range") || "1h";
    if (!Object.hasOwn(MONITOR_HISTORY_RANGES, range)) return monitorJson({ error: "invalid_range" }, 400);
    return monitorJson(await readMonitorHistory(range));
  } catch { return monitorJson({ error: "monitor_unavailable" }, 503); }
}
