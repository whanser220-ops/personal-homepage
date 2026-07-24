import { NextResponse } from "next/server";

import {
  DEFAULT_BUILD_PROGRESS_JOB,
  isBuildProgressDbNotConfigured,
  safeCompareSecret,
  writeBuildProgressEvent,
} from "@/src/server/buildProgressDb.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request) {
  const configuredToken = process.env.BUILD_PROGRESS_INGEST_TOKEN?.trim() || "";
  if (!configuredToken) {
    return NextResponse.json({ ok: false, error: "Build progress ingest is not configured." }, { status: 503 });
  }

  const providedToken = getBearerToken(request.headers.get("authorization") || "");
  if (!safeCompareSecret(providedToken, configuredToken)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const jobName = process.env.BUILD_PROGRESS_JOB?.trim() || DEFAULT_BUILD_PROGRESS_JOB;
    const result = await writeBuildProgressEvent(payload, jobName);
    return NextResponse.json(result);
  } catch (error) {
    if (isBuildProgressDbNotConfigured(error)) {
      return NextResponse.json({ ok: false, error: "Build progress database is not configured." }, { status: 503 });
    }

    return NextResponse.json({ ok: false, error: "Build progress ingest failed." }, { status: 500 });
  }
}

function getBearerToken(value) {
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : "";
}
