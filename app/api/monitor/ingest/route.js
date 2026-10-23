import { isMonitorIngestAuthorized } from "../../../../src/server/monitorAuth.js";
import { writeMonitorSamples } from "../../../../src/server/monitorDb.js";
import { monitorJson, readMonitorJsonBody } from "../../../../src/server/monitorHttp.js";
import { MonitorValidationError, normalizeMonitorBatch } from "../../../../src/server/monitorValidation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isMonitorIngestAuthorized(request)) return monitorJson({ error: "unauthorized" }, 401);
  try {
    const samples = normalizeMonitorBatch(await readMonitorJsonBody(request));
    return monitorJson({ ok: true, ...await writeMonitorSamples(samples) });
  } catch (error) {
    if (error instanceof MonitorValidationError) {
      return monitorJson({ error: error.message }, error.message === "payload_too_large" ? 413 : 400);
    }
    return monitorJson({ error: "ingest_unavailable" }, 503);
  }
}
