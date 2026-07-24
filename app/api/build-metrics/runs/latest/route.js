import { NextResponse } from "next/server";
import { readLatestBuildMetrics } from "../../../../../src/server/buildMetricsDb.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await readLatestBuildMetrics();
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        configured: true,
        source: "postgres",
        state: "unavailable",
        result: "",
        runId: "",
        jobName: process.env.BUILD_METRICS_JOB || "unity-linux-docker-build",
        buildNumber: null,
        currentStage: "",
        currentRun: null,
        stages: [],
        bundles: [],
        assetTypes: [],
        recentRuns: [],
        summary: {
          stageCount: 0,
          completedStageCount: 0,
          totalBundles: 0,
          completedBundles: 0,
          activeBundles: 0,
          assetTypeCount: 0,
          totalAssetBytes: 0,
          totalDurationMs: 0,
        },
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
