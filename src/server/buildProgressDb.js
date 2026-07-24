import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

export const DEFAULT_BUILD_PROGRESS_JOB = "unity-linux-docker-build";

const RECENT_RUN_LIMIT = 5;
const LOG_TAIL_LINES = 90;
const ARTIFACT_LIMIT = 20;
const MAX_SHORT_TEXT_LENGTH = 260;
const MAX_MESSAGE_LENGTH = 600;
const MAX_LOG_LINE_LENGTH = 260;
const MAX_METADATA_DEPTH = 3;
const MAX_METADATA_KEYS = 40;
const MAX_ARTIFACTS_PER_EVENT = 20;

const SECRET_PATTERN =
  /(api[_-]?token|authorization|password|passwd|secret|private[_ -]?key|credential|database_url|build_progress_ingest_token)/i;
const ANSI_HIDDEN_PATTERN = /\x1b\[8m[\s\S]*?\x1b\[0m/g;
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const URL_AUTH_PATTERN = /https?:\/\/[^\s/@]+:[^\s/@]+@/gi;

class BuildProgressDbNotConfigured extends Error {
  constructor() {
    super("Build progress database is not configured.");
    this.name = "BuildProgressDbNotConfigured";
  }
}

export function isBuildProgressDbNotConfigured(error) {
  return error instanceof BuildProgressDbNotConfigured;
}

export function isBuildProgressDbConfigured() {
  return Boolean(getDatabaseUrl());
}

export function safeCompareSecret(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function readBuildProgress(jobName = DEFAULT_BUILD_PROGRESS_JOB) {
  if (!isBuildProgressDbConfigured()) {
    return createMockPayload(jobName);
  }

  await ensureBuildProgressSchema();
  const pool = getPool();
  const normalizedJobName = sanitizeShortText(jobName || DEFAULT_BUILD_PROGRESS_JOB) || DEFAULT_BUILD_PROGRESS_JOB;

  const latestRunResult = await pool.query(
    `select run_id, job_name, build_number, git_ref, git_commit, state, result, percent, stage_id, stage_name,
            message, started_at, finished_at, elapsed_duration_ms, estimated_duration_ms, updated_at, metadata
       from build_runs
      where job_name = $1
      order by updated_at desc
      limit 1`,
    [normalizedJobName],
  );

  const recentRunsResult = await pool.query(
    `select run_id, build_number, state, result, percent, started_at, finished_at, elapsed_duration_ms, updated_at
       from build_runs
      where job_name = $1
      order by updated_at desc
      limit $2`,
    [normalizedJobName, RECENT_RUN_LIMIT],
  );

  if (latestRunResult.rowCount === 0) {
    return createNoDataPayload(normalizedJobName, recentRunsResult.rows);
  }

  const run = latestRunResult.rows[0];
  const [eventResult, artifactResult, logResult] = await Promise.all([
    pool.query(
      `select id, event_type, stage_id, stage_name, state, result, percent, message, created_at
         from build_events
        where run_id = $1 and coalesce(stage_name, '') <> ''
        order by id asc
        limit 300`,
      [run.run_id],
    ),
    pool.query(
      `select name, path, size_bytes, created_at
         from build_artifacts
        where run_id = $1
        order by created_at desc, id desc
        limit $2`,
      [run.run_id, ARTIFACT_LIMIT],
    ),
    pool.query(
      `select message, log_line
         from build_events
        where run_id = $1 and (coalesce(message, '') <> '' or coalesce(log_line, '') <> '')
        order by id desc
        limit $2`,
      [run.run_id, LOG_TAIL_LINES],
    ),
  ]);

  const state = normalizeState(run.state);
  const result = sanitizeResult(run.result);
  const durationMs = getDurationMs(run);
  const stages = createStageList(eventResult.rows, state);

  return {
    ok: true,
    source: "postgres",
    state,
    jobName: run.job_name || normalizedJobName,
    buildNumber: run.build_number,
    result,
    building: isActiveState(state),
    queueState: "idle",
    elapsedDurationMs: durationMs,
    estimatedDurationMs: Number(run.estimated_duration_ms || 0),
    percent: clampPercent(run.percent),
    queue: { inQueue: false, why: "" },
    currentBuild: {
      number: run.build_number,
      result,
      building: isActiveState(state),
      timestamp: run.started_at ? new Date(run.started_at).getTime() : null,
      durationMs,
      estimatedDurationMs: Number(run.estimated_duration_ms || 0),
    },
    progress: {
      percent: clampPercent(run.percent),
      label: progressLabel(state, result),
    },
    stages,
    recentRuns: recentRunsResult.rows.map(toRecentRun),
    artifacts: artifactResult.rows.map(toArtifact),
    logTail: createLogTail(logResult.rows),
    updatedAt: toIso(run.updated_at),
  };
}

export async function writeBuildProgressEvent(input, defaultJobName = DEFAULT_BUILD_PROGRESS_JOB) {
  if (!isBuildProgressDbConfigured()) {
    throw new BuildProgressDbNotConfigured();
  }

  await ensureBuildProgressSchema();

  const payload = normalizeIncomingPayload(input, defaultJobName);
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(
      `insert into build_runs (
          run_id, job_name, build_number, git_ref, git_commit, state, result, percent,
          stage_id, stage_name, message, started_at, finished_at, elapsed_duration_ms,
          estimated_duration_ms, updated_at, metadata
       )
       values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11,
          coalesce($12::timestamptz, now()),
          $13::timestamptz,
          $14, $15, now(), $16::jsonb
       )
       on conflict (run_id) do update set
          job_name = excluded.job_name,
          build_number = coalesce(excluded.build_number, build_runs.build_number),
          git_ref = coalesce(nullif(excluded.git_ref, ''), build_runs.git_ref),
          git_commit = coalesce(nullif(excluded.git_commit, ''), build_runs.git_commit),
          state = excluded.state,
          result = coalesce(nullif(excluded.result, ''), build_runs.result),
          percent = case when $17::boolean then excluded.percent else build_runs.percent end,
          stage_id = coalesce(nullif(excluded.stage_id, ''), build_runs.stage_id),
          stage_name = coalesce(nullif(excluded.stage_name, ''), build_runs.stage_name),
          message = coalesce(nullif(excluded.message, ''), build_runs.message),
          started_at = coalesce(build_runs.started_at, excluded.started_at),
          finished_at = case
              when excluded.finished_at is not null then excluded.finished_at
              when excluded.state in ('running', 'queued', 'unknown') then null
              else build_runs.finished_at
          end,
          elapsed_duration_ms = excluded.elapsed_duration_ms,
          estimated_duration_ms = excluded.estimated_duration_ms,
          updated_at = now(),
          metadata = build_runs.metadata || excluded.metadata`,
      [
        payload.runId,
        payload.jobName,
        payload.buildNumber,
        payload.gitRef,
        payload.gitCommit,
        payload.state,
        payload.result,
        payload.percent,
        payload.stageId,
        payload.stageName,
        payload.message,
        payload.startedAt,
        payload.finishedAt,
        payload.elapsedDurationMs,
        payload.estimatedDurationMs,
        JSON.stringify(payload.metadata),
        payload.hasPercent,
      ],
    );

    await insertEvent(client, payload);

    for (const logLine of payload.logTail) {
      await insertEvent(client, {
        ...payload,
        eventType: "log",
        message: "",
        logLine,
      });
    }

    for (const artifact of payload.artifacts) {
      await client.query(
        `insert into build_artifacts (run_id, name, path, size_bytes, metadata, created_at)
         values ($1, $2, $3, $4, $5::jsonb, now())
         on conflict (run_id, path) do update set
            name = excluded.name,
            size_bytes = excluded.size_bytes,
            metadata = build_artifacts.metadata || excluded.metadata,
            created_at = now()`,
        [
          payload.runId,
          artifact.name,
          artifact.path,
          artifact.sizeBytes,
          JSON.stringify(artifact.metadata || {}),
        ],
      );
    }

    await client.query("commit");
    return {
      ok: true,
      runId: payload.runId,
      jobName: payload.jobName,
      state: payload.state,
      percent: payload.percent,
      artifacts: payload.artifacts.length,
      logLines: payload.logTail.length,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function insertEvent(client, payload) {
  await client.query(
    `insert into build_events (
        run_id, job_name, event_type, stage_id, stage_name, state, result,
        percent, message, log_line, metadata, created_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, coalesce($12::timestamptz, now()))`,
    [
      payload.runId,
      payload.jobName,
      payload.eventType,
      payload.stageId,
      payload.stageName,
      payload.state,
      payload.result,
      payload.percent,
      payload.message,
      payload.logLine,
      JSON.stringify(payload.metadata),
      payload.timestamp,
    ],
  );
}

async function ensureBuildProgressSchema() {
  const globalKey = "__personalHomepageBuildProgressSchemaPromise";

  if (!globalThis[globalKey]) {
    globalThis[globalKey] = getPool()
      .query(
        `create table if not exists build_runs (
            id bigserial primary key,
            run_id text not null unique,
            job_name text not null,
            build_number integer,
            git_ref text,
            git_commit text,
            state text not null default 'unknown',
            result text not null default '',
            percent integer not null default 0 check (percent >= 0 and percent <= 100),
            stage_id text,
            stage_name text,
            message text,
            started_at timestamptz,
            finished_at timestamptz,
            elapsed_duration_ms bigint not null default 0,
            estimated_duration_ms bigint not null default 0,
            updated_at timestamptz not null default now(),
            metadata jsonb not null default '{}'::jsonb
         );

         create index if not exists build_runs_job_updated_idx
             on build_runs (job_name, updated_at desc);

         create table if not exists build_events (
            id bigserial primary key,
            run_id text not null references build_runs(run_id) on delete cascade,
            job_name text not null,
            event_type text not null,
            stage_id text,
            stage_name text,
            state text,
            result text,
            percent integer check (percent is null or (percent >= 0 and percent <= 100)),
            message text,
            log_line text,
            metadata jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now()
         );

         create index if not exists build_events_run_id_id_idx
             on build_events (run_id, id desc);

         create table if not exists build_artifacts (
            id bigserial primary key,
            run_id text not null references build_runs(run_id) on delete cascade,
            name text not null,
            path text not null,
            size_bytes bigint not null default 0,
            metadata jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now(),
            unique (run_id, path)
         );

         create index if not exists build_artifacts_run_id_idx
             on build_artifacts (run_id, created_at desc);`,
      )
      .catch((error) => {
        globalThis[globalKey] = null;
        throw error;
      });
  }

  return globalThis[globalKey];
}

function getPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new BuildProgressDbNotConfigured();
  }

  const globalKey = "__personalHomepageBuildProgressPool";
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });
  }

  return globalThis[globalKey];
}

function getDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || "";
}

function normalizeIncomingPayload(input, defaultJobName) {
  const eventType = sanitizeEventType(input.eventType || input.type || "heartbeat");
  const result = sanitizeResult(input.result || resultFromEventType(eventType));
  const state = normalizeState(input.state || stateFromEventType(eventType, result));
  const jobName = sanitizeShortText(input.jobName || defaultJobName || DEFAULT_BUILD_PROGRESS_JOB) || DEFAULT_BUILD_PROGRESS_JOB;
  const buildNumber = toOptionalInteger(input.buildNumber);
  const runId =
    sanitizeRunId(input.runId) ||
    sanitizeRunId(input.id) ||
    sanitizeRunId(buildNumber ? `${jobName}-${buildNumber}` : `${jobName}-${Date.now()}`);
  const rawPercent = input.percent ?? input.progress?.percent;
  const hasPercent = rawPercent !== null && rawPercent !== undefined && rawPercent !== "";
  const percent = hasPercent ? clampPercent(rawPercent) : null;
  const stageName = sanitizeShortText(input.stageName || input.stage || "");
  const message = sanitizeMessage(input.message || "");

  return {
    runId,
    jobName,
    buildNumber,
    gitRef: sanitizeShortText(input.gitRef || input.git_ref || ""),
    gitCommit: sanitizeShortText(input.gitCommit || input.git_commit || ""),
    eventType,
    state,
    result,
    percent: percent ?? percentFromState(state, result),
    hasPercent,
    stageId: sanitizeShortText(input.stageId || input.stage_id || stageName || ""),
    stageName,
    message,
    logLine: sanitizeLogLine(input.logLine || input.log || ""),
    logTail: normalizeLogTail(input.logTail),
    startedAt: parseDate(input.startedAt || input.started_at),
    finishedAt: isTerminalState(state, result) ? parseDate(input.finishedAt || input.finished_at) || new Date() : null,
    timestamp: parseDate(input.timestamp || input.createdAt || input.created_at),
    elapsedDurationMs: toNonNegativeInteger(input.elapsedDurationMs ?? input.elapsed_duration_ms),
    estimatedDurationMs: toNonNegativeInteger(input.estimatedDurationMs ?? input.estimated_duration_ms),
    metadata: sanitizeMetadata(input.metadata),
    artifacts: normalizeArtifacts(input.artifacts || input.artifact),
  };
}

function createStageList(rows, runState) {
  const stageMap = new Map();

  for (const row of rows) {
    const name = sanitizeShortText(row.stage_name || "");
    if (!name) {
      continue;
    }

    const key = sanitizeShortText(row.stage_id || name);
    const state = normalizeState(row.state);
    const result = sanitizeResult(row.result);
    const previous = stageMap.get(key);
    const startedAt = previous?.startedAt || row.created_at;
    const latestAt = row.created_at;

    stageMap.set(key, {
      id: key,
      name,
      state: isActiveState(state) ? "RUNNING" : "FINISHED",
      result,
      startTime: toIso(startedAt),
      durationMs: getDateDeltaMs(startedAt, latestAt),
      order: Number(row.id),
    });
  }

  const stages = Array.from(stageMap.values()).sort((a, b) => a.order - b.order);
  const activeStageIndex = stages.findLastIndex((stage) => stage.state === "RUNNING");

  return stages.map((stage, index) => {
    if (!isActiveState(runState) || index !== activeStageIndex) {
      return {
        ...stage,
        state: "FINISHED",
        result: stage.result || "SUCCESS",
      };
    }

    return stage;
  });
}

function toRecentRun(row) {
  return {
    id: String(row.build_number || row.run_id || ""),
    state: normalizeState(row.state),
    result: sanitizeResult(row.result),
    summary: progressLabel(row.state, row.result),
    startTime: toIso(row.started_at),
    endTime: toIso(row.finished_at),
    durationMs: getDurationMs(row),
  };
}

function toArtifact(row) {
  return {
    name: sanitizeShortText(row.name || ""),
    path: sanitizeShortText(row.path || ""),
    sizeBytes: Number(row.size_bytes || 0),
  };
}

function createLogTail(rows) {
  const lines = [];

  for (const row of rows.slice().reverse()) {
    const source = row.log_line || row.message || "";
    for (const line of String(source).split(/\r?\n/)) {
      const sanitized = sanitizeLogLine(line);
      if (sanitized) {
        lines.push(sanitized);
      }
    }
  }

  return lines.slice(-LOG_TAIL_LINES);
}

function createNoDataPayload(jobName, recentRows) {
  return {
    ok: true,
    source: "postgres",
    state: "idle",
    jobName,
    buildNumber: null,
    result: "",
    building: false,
    queueState: "idle",
    elapsedDurationMs: 0,
    estimatedDurationMs: 0,
    percent: 0,
    queue: { inQueue: false, why: "" },
    currentBuild: null,
    progress: { percent: 0, label: "No recent build" },
    stages: [],
    recentRuns: recentRows.map(toRecentRun),
    artifacts: [],
    logTail: ["No build progress events have been reported yet."],
    updatedAt: new Date().toISOString(),
  };
}

export function createMockPayload(jobName = DEFAULT_BUILD_PROGRESS_JOB) {
  return {
    ok: true,
    source: "mock",
    state: "unconfigured",
    jobName,
    buildNumber: null,
    result: "",
    building: false,
    queueState: "idle",
    elapsedDurationMs: 0,
    estimatedDurationMs: 0,
    percent: 0,
    queue: { inQueue: false, why: "" },
    currentBuild: null,
    progress: { percent: 0, label: "Not configured" },
    stages: [],
    recentRuns: [],
    artifacts: [],
    logTail: ["Build progress database is not configured for this runtime."],
    updatedAt: new Date().toISOString(),
  };
}

export function createUnavailablePayload(jobName = DEFAULT_BUILD_PROGRESS_JOB) {
  return {
    ok: false,
    source: "postgres",
    state: "unavailable",
    jobName,
    buildNumber: null,
    result: "",
    building: false,
    queueState: "idle",
    elapsedDurationMs: 0,
    estimatedDurationMs: 0,
    percent: 0,
    queue: { inQueue: false, why: "" },
    currentBuild: null,
    progress: { percent: 0, label: "Progress database unavailable" },
    stages: [],
    recentRuns: [],
    artifacts: [],
    logTail: [],
    error: "Build progress is unavailable.",
    updatedAt: new Date().toISOString(),
  };
}

function normalizeArtifacts(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];

  return list.slice(0, MAX_ARTIFACTS_PER_EVENT).map((artifact) => {
    const path = sanitizeShortText(artifact.path || artifact.file || artifact.url || artifact.name || "");
    const name = sanitizeShortText(artifact.name || path.split(/[\\/]/).pop() || "artifact");

    return {
      name,
      path,
      sizeBytes: toNonNegativeInteger(artifact.sizeBytes ?? artifact.size_bytes ?? artifact.size),
      metadata: sanitizeMetadata(artifact.metadata),
    };
  }).filter((artifact) => artifact.name && artifact.path);
}

function normalizeLogTail(value) {
  if (!value) {
    return [];
  }

  const lines = Array.isArray(value) ? value : String(value).split(/\r?\n/);
  return lines.map(sanitizeLogLine).filter(Boolean).slice(-LOG_TAIL_LINES);
}

function sanitizeMetadata(value, depth = 0) {
  if (!value || typeof value !== "object" || depth >= MAX_METADATA_DEPTH) {
    return {};
  }

  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_METADATA_KEYS)) {
    const safeKey = sanitizeShortText(key);
    if (!safeKey) {
      continue;
    }

    if (SECRET_PATTERN.test(safeKey)) {
      output[safeKey] = "[redacted]";
      continue;
    }

    if (item === null || typeof item === "boolean" || typeof item === "number") {
      output[safeKey] = item;
    } else if (typeof item === "string") {
      output[safeKey] = sanitizeShortText(item);
    } else if (Array.isArray(item)) {
      output[safeKey] = item.slice(0, 20).map((entry) => (
        typeof entry === "object" && entry !== null ? sanitizeMetadata(entry, depth + 1) : sanitizeShortText(entry)
      ));
    } else if (typeof item === "object") {
      output[safeKey] = sanitizeMetadata(item, depth + 1);
    }
  }

  return output;
}

function sanitizeEventType(value) {
  const text = sanitizeShortText(value || "heartbeat").toLowerCase();
  return text.replace(/[^a-z0-9_.-]/g, "-").slice(0, 80) || "heartbeat";
}

function sanitizeRunId(value) {
  return sanitizeShortText(value || "").replace(/[^A-Za-z0-9_.:/-]/g, "-").slice(0, 180);
}

function sanitizeResult(value) {
  return sanitizeShortText(value || "").toUpperCase().replace(/[^A-Z0-9_.-]/g, "-").slice(0, 40);
}

function sanitizeMessage(value) {
  return sanitizeText(value, MAX_MESSAGE_LENGTH);
}

function sanitizeLogLine(value) {
  return sanitizeText(value, MAX_LOG_LINE_LENGTH);
}

function sanitizeShortText(value) {
  return sanitizeText(value, MAX_SHORT_TEXT_LENGTH);
}

function sanitizeText(value, maxLength) {
  const text = String(value || "")
    .replace(ANSI_HIDDEN_PATTERN, "")
    .replace(ANSI_PATTERN, "")
    .replace(URL_AUTH_PATTERN, "https://<redacted>@")
    .trim();

  if (!text) {
    return "";
  }

  if (SECRET_PATTERN.test(text)) {
    return "[redacted sensitive text]";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeState(value) {
  const state = sanitizeShortText(value || "unknown").toLowerCase();

  if (["success", "succeeded", "passed", "complete", "completed"].includes(state)) {
    return "success";
  }

  if (["failure", "failed", "error"].includes(state)) {
    return "failure";
  }

  if (["aborted", "abort", "canceled", "cancelled"].includes(state)) {
    return "aborted";
  }

  if (["queued", "queue"].includes(state)) {
    return "queued";
  }

  if (["running", "started", "start", "heartbeat", "progress", "stage"].includes(state)) {
    return "running";
  }

  if (["idle", "unconfigured", "unavailable"].includes(state)) {
    return state;
  }

  return "unknown";
}

function stateFromEventType(eventType, result) {
  if (result) {
    return result;
  }

  if (["success", "complete", "completed"].includes(eventType)) {
    return "success";
  }

  if (["failure", "failed", "error"].includes(eventType)) {
    return "failure";
  }

  if (["aborted", "canceled", "cancelled"].includes(eventType)) {
    return "aborted";
  }

  if (eventType === "queued") {
    return "queued";
  }

  return "running";
}

function resultFromEventType(eventType) {
  if (["success", "complete", "completed"].includes(eventType)) {
    return "SUCCESS";
  }

  if (["failure", "failed", "error"].includes(eventType)) {
    return "FAILURE";
  }

  if (["aborted", "canceled", "cancelled"].includes(eventType)) {
    return "ABORTED";
  }

  return "";
}

function percentFromState(state, result) {
  if (state === "success" || result === "SUCCESS") {
    return 100;
  }

  if (state === "failure" || state === "aborted") {
    return 100;
  }

  return 0;
}

function progressLabel(state, result) {
  if (result) {
    return result;
  }

  if (state === "running") {
    return "Running";
  }

  if (state === "queued") {
    return "Queued";
  }

  if (state === "idle") {
    return "No recent build";
  }

  return state || "Unknown";
}

function isActiveState(state) {
  return state === "running" || state === "queued";
}

function isTerminalState(state, result) {
  return ["success", "failure", "aborted"].includes(state) || ["SUCCESS", "FAILURE", "ABORTED"].includes(result);
}

function clampPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function toOptionalInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function toNonNegativeInteger(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function getDurationMs(row) {
  const explicit = Number(row.elapsed_duration_ms || row.elapsedDurationMs || 0);
  if (explicit > 0) {
    return explicit;
  }

  const start = row.started_at ? new Date(row.started_at).getTime() : 0;
  if (start <= 0) {
    return 0;
  }

  const end = row.finished_at ? new Date(row.finished_at).getTime() : Date.now();
  return Math.max(0, end - start);
}

function getDateDeltaMs(start, end) {
  const startMs = start ? new Date(start).getTime() : 0;
  const endMs = end ? new Date(end).getTime() : 0;
  if (startMs <= 0 || endMs <= 0) {
    return 0;
  }

  return Math.max(0, endMs - startMs);
}
