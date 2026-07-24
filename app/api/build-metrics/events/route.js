import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { publishBuildMetricsSnapshot } from "../../../../src/server/buildMetricsStream.js";
import {
  isBuildMetricsDbNotConfigured,
  writeBuildMetricEvent,
} from "../../../../src/server/buildMetricsDb.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 128 * 1024;

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let payload;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }

    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const snapshot = await writeBuildMetricEvent(payload);
    publishBuildMetricsSnapshot(snapshot);
    return NextResponse.json({ ok: true, runId: snapshot.runId });
  } catch (error) {
    const status = isBuildMetricsDbNotConfigured(error) ? 503 : 500;
    return NextResponse.json({ ok: false, error: "ingest_unavailable" }, { status });
  }
}

function isAuthorized(request) {
  const expected = process.env.BUILD_METRICS_INGEST_TOKEN?.trim();
  if (!expected) {
    return false;
  }

  const header = request.headers.get("authorization") || "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return false;
  }

  const actual = header.slice(prefix.length).trim();
  if (!actual) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
