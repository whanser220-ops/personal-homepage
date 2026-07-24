import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_JOB = "unity-linux-docker-build";
const LOG_TAIL_BYTES = 12000;
const LOG_TAIL_LINES = 90;
const REQUEST_TIMEOUT_MS = 8000;
const RUN_LIMIT = 5;

export async function GET() {
  const config = getJenkinsConfig();

  if (!config || process.env.JENKINS_MOCK === "true") {
    return NextResponse.json(createMockPayload(config?.jobName || process.env.JENKINS_JOB || DEFAULT_JOB));
  }

  try {
    const job = await fetchJson(config, jobApiPath(config.jobName));
    const currentNumber = job.lastBuild?.number || null;
    const runId = currentNumber ? String(currentNumber) : null;

    const [runs, stages, artifacts, logTail] = await Promise.all([
      fetchOptionalJson(config, blueRunsPath(config.jobName)),
      runId ? fetchOptionalJson(config, blueRunNodesPath(config.jobName, runId)) : [],
      runId ? fetchOptionalJson(config, blueArtifactsPath(config.jobName, runId)) : [],
      runId ? fetchLogTail(config, config.jobName, runId) : [],
    ]);

    return NextResponse.json(
      createProgressPayload({
        job,
        runs: normalizeList(runs),
        stages: normalizeList(stages),
        artifacts: normalizeList(artifacts),
        logTail,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: "jenkins",
        state: "unavailable",
        jobName: config.jobName,
        queue: { inQueue: false, why: "" },
        currentBuild: null,
        progress: { percent: 0, label: "Jenkins unavailable" },
        stages: [],
        recentRuns: [],
        artifacts: [],
        logTail: [],
        error: "Jenkins status is unavailable.",
        updatedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
}

function getJenkinsConfig() {
  const baseUrl = process.env.JENKINS_URL?.trim().replace(/\/+$/, "");
  const user = process.env.JENKINS_USER?.trim();
  const token = process.env.JENKINS_API_TOKEN?.trim();
  const jobName = process.env.JENKINS_JOB?.trim() || DEFAULT_JOB;

  if (!baseUrl || !user || !token) {
    return null;
  }

  return {
    baseUrl,
    jobName,
    authorization: `Basic ${Buffer.from(`${user}:${token}`, "utf8").toString("base64")}`,
  };
}

function createProgressPayload({ job, runs, stages, artifacts, logTail }) {
  const currentBuild = job.lastBuild || null;
  const building = Boolean(currentBuild?.building);
  const inQueue = Boolean(job.inQueue);
  const progress = computeProgress(currentBuild, inQueue);

  return {
    ok: true,
    source: "jenkins",
    state: inQueue ? "queued" : building ? "running" : resultToState(currentBuild?.result),
    jobName: job.displayName || DEFAULT_JOB,
    queue: {
      inQueue,
      why: sanitizeShortText(job.queueItem?.why || ""),
    },
    currentBuild: currentBuild
      ? {
          number: currentBuild.number,
          result: currentBuild.result || "",
          building,
          timestamp: currentBuild.timestamp || null,
          durationMs: currentBuild.duration || 0,
          estimatedDurationMs: currentBuild.estimatedDuration || 0,
        }
      : null,
    progress,
    stages: stages.map(toStage),
    recentRuns: runs.slice(0, RUN_LIMIT).map(toRun),
    artifacts: artifacts.map(toArtifact),
    logTail,
    updatedAt: new Date().toISOString(),
  };
}

function computeProgress(build, inQueue) {
  if (inQueue) {
    return { percent: 0, label: "Queued" };
  }

  if (!build) {
    return { percent: 0, label: "No build" };
  }

  if (!build.building) {
    return { percent: 100, label: build.result || "Finished" };
  }

  const startedAt = Number(build.timestamp || 0);
  const estimated = Number(build.estimatedDuration || 0);
  const elapsed = startedAt > 0 ? Date.now() - startedAt : Number(build.duration || 0);
  const percent = estimated > 0 ? Math.min(99, Math.max(1, Math.round((elapsed / estimated) * 100))) : 1;

  return {
    percent,
    label: "Running",
  };
}

async function fetchLogTail(config, jobName, runId) {
  const initial = await fetchText(config, `${classicRunPath(jobName, runId)}/logText/progressiveText?start=999999999`);
  const textSize = Number(initial.headers.get("x-text-size") || "0");
  const start = Math.max(0, textSize - LOG_TAIL_BYTES);
  const response = await fetchText(config, `${classicRunPath(jobName, runId)}/logText/progressiveText?start=${start}`);
  return sanitizeLog(response.text);
}

async function fetchJson(config, path) {
  const response = await fetchWithTimeout(`${config.baseUrl}${path}`, {
    headers: {
      Authorization: config.authorization,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Jenkins HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchOptionalJson(config, path) {
  try {
    return await fetchJson(config, path);
  } catch {
    return [];
  }
}

async function fetchText(config, path) {
  const response = await fetchWithTimeout(`${config.baseUrl}${path}`, {
    headers: {
      Authorization: config.authorization,
      Accept: "text/plain",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Jenkins log HTTP ${response.status}`);
  }

  return {
    headers: response.headers,
    text: await response.text(),
  };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function jobApiPath(jobName) {
  return `${classicJobPath(jobName)}/api/json?tree=displayName,color,buildable,inQueue,queueItem[id,why],lastBuild[number,result,building,timestamp,duration,estimatedDuration],lastCompletedBuild[number,result,timestamp,duration]`;
}

function blueRunsPath(jobName) {
  return `/blue/rest/organizations/jenkins/pipelines/${encodeURIComponent(jobName)}/runs/?limit=${RUN_LIMIT}`;
}

function blueRunNodesPath(jobName, runId) {
  return `/blue/rest/organizations/jenkins/pipelines/${encodeURIComponent(jobName)}/runs/${encodeURIComponent(runId)}/nodes/`;
}

function blueArtifactsPath(jobName, runId) {
  return `/blue/rest/organizations/jenkins/pipelines/${encodeURIComponent(jobName)}/runs/${encodeURIComponent(runId)}/artifacts/`;
}

function classicRunPath(jobName, runId) {
  return `${classicJobPath(jobName)}/${encodeURIComponent(runId)}`;
}

function classicJobPath(jobName) {
  return jobName
    .split("/")
    .filter(Boolean)
    .map((part) => `/job/${encodeURIComponent(part)}`)
    .join("");
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.value)) {
    return value.value;
  }

  return [];
}

function toStage(stage) {
  return {
    id: String(stage.id || stage.displayName || ""),
    name: sanitizeShortText(stage.displayName || "Stage"),
    state: sanitizeShortText(stage.state || ""),
    result: sanitizeShortText(stage.result || ""),
    startTime: sanitizeShortText(stage.startTime || ""),
    durationMs: Number(stage.durationInMillis || 0),
  };
}

function toRun(run) {
  return {
    id: String(run.id || ""),
    state: sanitizeShortText(run.state || ""),
    result: sanitizeShortText(run.result || ""),
    summary: sanitizeShortText(run.runSummary || ""),
    startTime: sanitizeShortText(run.startTime || ""),
    endTime: sanitizeShortText(run.endTime || ""),
    durationMs: Number(run.durationInMillis || 0),
  };
}

function toArtifact(artifact) {
  return {
    name: sanitizeShortText(artifact.name || ""),
    path: sanitizeShortText(artifact.path || ""),
    sizeBytes: Number(artifact.size || 0),
  };
}

function sanitizeLog(text) {
  return text
    .replace(/\x1b\[8m[\s\S]*?\x1b\[0m/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => redactLine(line.trimEnd()))
    .filter(Boolean)
    .slice(-LOG_TAIL_LINES)
    .map((line) => (line.length > 260 ? `${line.slice(0, 260)}...` : line));
}

function redactLine(line) {
  const normalized = line.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://<redacted>@");

  if (/(api[_-]?token|authorization|password|passwd|secret|private[_ -]?key|credential)/i.test(normalized)) {
    return "[redacted sensitive log line]";
  }

  return normalized;
}

function sanitizeShortText(value) {
  return String(value || "")
    .replace(/\x1b\[8m[\s\S]*?\x1b\[0m/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://<redacted>@")
    .slice(0, 260);
}

function resultToState(result) {
  if (!result) {
    return "unknown";
  }

  return String(result).toLowerCase();
}

function createMockPayload(jobName) {
  return {
    ok: true,
    source: "mock",
    state: "unconfigured",
    jobName,
    queue: { inQueue: false, why: "" },
    currentBuild: null,
    progress: { percent: 0, label: "Not configured" },
    stages: [],
    recentRuns: [],
    artifacts: [],
    logTail: ["Jenkins environment variables are not configured for this runtime."],
    updatedAt: new Date().toISOString(),
  };
}
