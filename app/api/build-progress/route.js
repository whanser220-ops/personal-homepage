import { NextResponse } from "next/server";

import {
  DEFAULT_BUILD_PROGRESS_JOB,
  createUnavailablePayload,
  readBuildProgress,
} from "@/src/server/buildProgressDb.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const jobName = process.env.BUILD_PROGRESS_JOB?.trim() || DEFAULT_BUILD_PROGRESS_JOB;

  try {
    return NextResponse.json(await readBuildProgress(jobName));
  } catch {
    return NextResponse.json(createUnavailablePayload(jobName), { status: 200 });
  }
}
