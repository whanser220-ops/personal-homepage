import pg from "pg";

const { Pool } = pg;

const DEFAULT_JOB_NAME = process.env.BUILD_METRICS_JOB || "unity-linux-docker-build";
const MAX_TEXT_LENGTH = 2048;
const MAX_NAME_LENGTH = 256;
const MAX_METADATA_KEYS = 80;
const MAX_ASSET_TYPE_ROWS = 80;
const SECRET_KEY_PATTERN = /(token|password|passwd|secret|authorization|credential|private[_-]?key|database_url)/i;
const SECRET_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._~+/=-]+|-----begin [a-z ]*private key-----|database_url=|api[_-]?token|ingest[_-]?token)/i;

export class BuildMetricsDbNotConfigured extends Error {
  constructor() {
    super("Build metrics database is not configured.");
    this.name = "BuildMetricsDbNotConfigured";
  }
}

export function isBuildMetricsDbNotConfigured(error) {
  return error instanceof BuildMetricsDbNotConfigured;
}

export function isBuildMetricsDbConfigured() {
  return Boolean(getDatabaseUrl());
}

export async function readLatestBuildMetrics(runId) {
  if (!isBuildMetricsDbConfigured()) {
    return createUnconfiguredSnapshot();
  }

  await ensureBuildMetricsSchema();
  const pool = getPool();

  const runResult = runId
    ? await pool.query("select * from build_metric_runs where run_id = $1", [runId])
    : await pool.query("select * from build_metric_runs order by updated_at desc limit 1");

  if (runResult.rowCount === 0) {
    return createEmptySnapshot();
  }

  const run = runResult.rows[0];
  const [stageResult, bundleResult, assetTypeResult, recentRunResult] = await Promise.all([
    pool.query(
      `select *
         from build_metric_stages
        where run_id = $1
        order by coalesce(started_at, updated_at), stage_id`,
      [run.run_id],
    ),
    pool.query(
      `select *
         from build_metric_bundles
        where run_id = $1
        order by
          case when state = 'running' then 0 else 1 end,
          coalesce(started_at, updated_at),
          bundle_name
        limit 250`,
      [run.run_id],
    ),
    pool.query(
      `select *
         from build_metric_asset_types
        where run_id = $1
        order by size_bytes desc, asset_count desc, asset_type
        limit 80`,
      [run.run_id],
    ),
    pool.query(
      `select run_id, job_name, build_number, state, result, started_at, finished_at,
              total_duration_ms, updated_at
         from build_metric_runs
        order by updated_at desc
        limit 10`,
    ),
  ]);

  return {
    configured: true,
    source: "postgres",
    state: run.state || "idle",
    result: run.result || "",
    runId: run.run_id,
    jobName: run.job_name,
    buildNumber: run.build_number,
    currentStage: run.current_stage_name || "",
    updatedAt: toIso(run.updated_at),
    currentRun: toRun(run),
    stages: stageResult.rows.map(toStage),
    bundles: bundleResult.rows.map(toBundle),
    assetTypes: assetTypeResult.rows.map(toAssetType),
    recentRuns: recentRunResult.rows.map(toRun),
    summary: createSummary(run, stageResult.rows, bundleResult.rows, assetTypeResult.rows),
  };
}

export async function writeBuildMetricEvent(input, defaultJobName = DEFAULT_JOB_NAME) {
  if (!isBuildMetricsDbConfigured()) {
    throw new BuildMetricsDbNotConfigured();
  }

  const event = normalizeEvent(input, defaultJobName);
  await ensureBuildMetricsSchema();

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await upsertRun(client, event);
    await upsertStage(client, event);
    await upsertBundle(client, event);
    await upsertAssetTypes(client, event);
    await appendEvent(client, event);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return readLatestBuildMetrics(event.runId);
}

async function upsertRun(client, event) {
  const terminal = event.state === "success" || event.state === "failure";
  const startedAt = event.eventType === "run_started" || event.eventType === "stage_started" ? event.createdAt : null;
  const finishedAt = terminal || event.eventType === "run_finished" ? event.createdAt : null;

  await client.query(
    `insert into build_metric_runs (
       run_id, job_name, build_number, git_ref, git_commit, build_target, package_name,
       state, result, current_stage_id, current_stage_name, started_at, finished_at,
       total_duration_ms, metadata, updated_at
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb, now())
     on conflict (run_id) do update set
       job_name = excluded.job_name,
       build_number = coalesce(excluded.build_number, build_metric_runs.build_number),
       git_ref = coalesce(nullif(excluded.git_ref, ''), build_metric_runs.git_ref),
       git_commit = coalesce(nullif(excluded.git_commit, ''), build_metric_runs.git_commit),
       build_target = coalesce(nullif(excluded.build_target, ''), build_metric_runs.build_target),
       package_name = coalesce(nullif(excluded.package_name, ''), build_metric_runs.package_name),
       state = excluded.state,
       result = coalesce(nullif(excluded.result, ''), build_metric_runs.result),
       current_stage_id = coalesce(nullif(excluded.current_stage_id, ''), build_metric_runs.current_stage_id),
       current_stage_name = coalesce(nullif(excluded.current_stage_name, ''), build_metric_runs.current_stage_name),
       started_at = coalesce(build_metric_runs.started_at, excluded.started_at),
       finished_at = coalesce(excluded.finished_at, build_metric_runs.finished_at),
       total_duration_ms = coalesce(excluded.total_duration_ms, build_metric_runs.total_duration_ms),
       metadata = build_metric_runs.metadata || excluded.metadata,
       updated_at = now()`,
    [
      event.runId,
      event.jobName,
      event.buildNumber,
      event.gitRef,
      event.gitCommit,
      event.buildTarget,
      event.packageName,
      event.state,
      event.result,
      event.stageId,
      event.stageName,
      startedAt,
      finishedAt,
      event.durationMs,
      JSON.stringify(event.metadata),
    ],
  );
}

async function upsertStage(client, event) {
  if (!event.stageId) {
    return;
  }

  const startedAt = event.eventType === "stage_started" ? event.createdAt : null;
  const finishedAt =
    event.eventType === "stage_finished" ||
    event.eventType === "stage_failed" ||
    event.state === "success" ||
    event.state === "failure"
      ? event.createdAt
      : null;
  const stageState = finishedAt ? event.state || "success" : event.state || "running";

  await client.query(
    `insert into build_metric_stages (
       run_id, stage_id, stage_name, state, started_at, finished_at,
       duration_ms, metadata, updated_at
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
     on conflict (run_id, stage_id) do update set
       stage_name = coalesce(nullif(excluded.stage_name, ''), build_metric_stages.stage_name),
       state = excluded.state,
       started_at = coalesce(build_metric_stages.started_at, excluded.started_at),
       finished_at = coalesce(excluded.finished_at, build_metric_stages.finished_at),
       duration_ms = coalesce(excluded.duration_ms, build_metric_stages.duration_ms),
       metadata = build_metric_stages.metadata || excluded.metadata,
       updated_at = now()`,
    [
      event.runId,
      event.stageId,
      event.stageName,
      stageState,
      startedAt,
      finishedAt,
      event.durationMs,
      JSON.stringify(event.metadata),
    ],
  );
}

async function upsertBundle(client, event) {
  if (!event.bundleName) {
    return;
  }

  const startedAt = event.eventType === "bundle_started" ? event.createdAt : null;
  const finishedAt = event.eventType === "bundle_finished" || event.eventType === "bundle_failed" ? event.createdAt : null;
  const bundleState = finishedAt ? event.state || "success" : event.state || "running";

  await client.query(
    `insert into build_metric_bundles (
       run_id, bundle_name, state, started_at, finished_at, duration_ms,
       input_size_bytes, size_bytes, asset_count, cached, completed_bundles,
       total_bundles, metadata, updated_at
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb, now())
     on conflict (run_id, bundle_name) do update set
       state = excluded.state,
       started_at = coalesce(build_metric_bundles.started_at, excluded.started_at),
       finished_at = coalesce(excluded.finished_at, build_metric_bundles.finished_at),
       duration_ms = coalesce(excluded.duration_ms, build_metric_bundles.duration_ms),
       input_size_bytes = coalesce(excluded.input_size_bytes, build_metric_bundles.input_size_bytes),
       size_bytes = coalesce(excluded.size_bytes, build_metric_bundles.size_bytes),
       asset_count = coalesce(excluded.asset_count, build_metric_bundles.asset_count),
       cached = coalesce(excluded.cached, build_metric_bundles.cached),
       completed_bundles = coalesce(excluded.completed_bundles, build_metric_bundles.completed_bundles),
       total_bundles = coalesce(excluded.total_bundles, build_metric_bundles.total_bundles),
       metadata = build_metric_bundles.metadata || excluded.metadata,
       updated_at = now()`,
    [
      event.runId,
      event.bundleName,
      bundleState,
      startedAt,
      finishedAt,
      event.durationMs,
      event.inputSizeBytes,
      event.sizeBytes,
      event.assetCount,
      event.cached,
      event.completedBundles,
      event.totalBundles,
      JSON.stringify(event.metadata),
    ],
  );
}

async function upsertAssetTypes(client, event) {
  if (event.assetTypes.length === 0) {
    return;
  }

  await client.query("delete from build_metric_asset_types where run_id = $1", [event.runId]);
  for (const item of event.assetTypes) {
    await client.query(
      `insert into build_metric_asset_types (run_id, asset_type, asset_count, size_bytes, updated_at)
       values ($1,$2,$3,$4,now())
       on conflict (run_id, asset_type) do update set
         asset_count = excluded.asset_count,
         size_bytes = excluded.size_bytes,
         updated_at = now()`,
      [event.runId, item.assetType, item.count, item.sizeBytes],
    );
  }
}

async function appendEvent(client, event) {
  await client.query(
    `insert into build_metric_events (
       run_id, event_type, stage_id, stage_name, bundle_name, state, result,
       message, duration_ms, payload, created_at
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [
      event.runId,
      event.eventType,
      event.stageId,
      event.stageName,
      event.bundleName,
      event.state,
      event.result,
      event.message,
      event.durationMs,
      JSON.stringify(event.payload),
      event.createdAt,
    ],
  );
}

async function ensureBuildMetricsSchema() {
  const globalKey = "__personalHomepageBuildMetricsSchemaPromise";
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = getPool().query(`
      create table if not exists build_metric_runs (
        run_id text primary key,
        job_name text not null,
        build_number integer,
        git_ref text not null default '',
        git_commit text not null default '',
        build_target text not null default '',
        package_name text not null default '',
        state text not null default 'running',
        result text not null default '',
        current_stage_id text not null default '',
        current_stage_name text not null default '',
        started_at timestamptz,
        finished_at timestamptz,
        total_duration_ms bigint,
        metadata jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );

      create table if not exists build_metric_stages (
        run_id text not null references build_metric_runs(run_id) on delete cascade,
        stage_id text not null,
        stage_name text not null default '',
        state text not null default 'running',
        started_at timestamptz,
        finished_at timestamptz,
        duration_ms bigint,
        metadata jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        primary key (run_id, stage_id)
      );

      create table if not exists build_metric_bundles (
        run_id text not null references build_metric_runs(run_id) on delete cascade,
        bundle_name text not null,
        state text not null default 'running',
        started_at timestamptz,
        finished_at timestamptz,
        duration_ms bigint,
        input_size_bytes bigint,
        size_bytes bigint,
        asset_count integer,
        cached boolean,
        completed_bundles integer,
        total_bundles integer,
        metadata jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        primary key (run_id, bundle_name)
      );

      create table if not exists build_metric_asset_types (
        run_id text not null references build_metric_runs(run_id) on delete cascade,
        asset_type text not null,
        asset_count integer not null default 0,
        size_bytes bigint not null default 0,
        updated_at timestamptz not null default now(),
        primary key (run_id, asset_type)
      );

      create table if not exists build_metric_events (
        id bigserial primary key,
        run_id text not null references build_metric_runs(run_id) on delete cascade,
        event_type text not null,
        stage_id text not null default '',
        stage_name text not null default '',
        bundle_name text not null default '',
        state text not null default '',
        result text not null default '',
        message text not null default '',
        duration_ms bigint,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      create index if not exists build_metric_runs_updated_at_idx
        on build_metric_runs (updated_at desc);
      create index if not exists build_metric_events_run_created_at_idx
        on build_metric_events (run_id, created_at desc);
    `);
  }

  return globalThis[globalKey];
}

function getPool() {
  if (!getDatabaseUrl()) {
    throw new BuildMetricsDbNotConfigured();
  }

  const globalKey = "__personalHomepageBuildMetricsPool";
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = new Pool({
      connectionString: getDatabaseUrl(),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
    });
  }

  return globalThis[globalKey];
}

function getDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || "";
}

function normalizeEvent(input, defaultJobName) {
  const source = input && typeof input === "object" ? input : {};
  const jobName = cleanName(source.jobName || defaultJobName || DEFAULT_JOB_NAME, DEFAULT_JOB_NAME);
  const buildNumber = toInteger(source.buildNumber);
  const runId = cleanName(source.runId || `${jobName}-${buildNumber || "local"}`, `${jobName}-local`);
  const eventType = cleanName(source.eventType || "event", "event").toLowerCase();
  const state = normalizeState(source.state, eventType);
  const result = normalizeResult(source.result, state);
  const durationMs = toNonNegativeInteger(source.durationMs ?? source.elapsedMs);

  const event = {
    runId,
    jobName,
    buildNumber,
    eventType,
    state,
    result,
    stageId: cleanName(source.stageId || "", ""),
    stageName: cleanText(source.stageName || "", MAX_NAME_LENGTH),
    bundleName: cleanText(source.bundleName || "", MAX_NAME_LENGTH),
    message: cleanText(source.message || "", MAX_TEXT_LENGTH),
    durationMs,
    totalBundles: toInteger(source.totalBundles),
    completedBundles: toInteger(source.completedBundles),
    sizeBytes: toNonNegativeInteger(source.sizeBytes),
    inputSizeBytes: toNonNegativeInteger(source.inputSizeBytes),
    assetCount: toInteger(source.assetCount),
    cached: typeof source.cached === "boolean" ? source.cached : null,
    gitRef: cleanText(source.gitRef || "", MAX_NAME_LENGTH),
    gitCommit: cleanText(source.gitCommit || "", MAX_NAME_LENGTH),
    buildTarget: cleanText(source.buildTarget || "", MAX_NAME_LENGTH),
    packageName: cleanText(source.packageName || "", MAX_NAME_LENGTH),
    metadata: sanitizeMetadata(source.metadata),
    assetTypes: sanitizeAssetTypes(source.assetTypes),
    createdAt: new Date(),
  };

  event.payload = {
    eventType: event.eventType,
    state: event.state,
    result: event.result,
    stageId: event.stageId,
    stageName: event.stageName,
    bundleName: event.bundleName,
    message: event.message,
    durationMs: event.durationMs,
    totalBundles: event.totalBundles,
    completedBundles: event.completedBundles,
    sizeBytes: event.sizeBytes,
    inputSizeBytes: event.inputSizeBytes,
    assetCount: event.assetCount,
    cached: event.cached,
    gitRef: event.gitRef,
    gitCommit: event.gitCommit,
    buildTarget: event.buildTarget,
    packageName: event.packageName,
    metadata: event.metadata,
    assetTypes: event.assetTypes,
  };

  return event;
}

function normalizeState(value, eventType) {
  const state = cleanName(value || "", "").toLowerCase();
  if (["running", "success", "failure", "idle", "queued"].includes(state)) {
    return state;
  }
  if (eventType.endsWith("_finished") || eventType === "success" || eventType === "run_finished") {
    return "success";
  }
  if (eventType.endsWith("_failed") || eventType === "failure") {
    return "failure";
  }
  return "running";
}

function normalizeResult(value, state) {
  const result = cleanName(value || "", "").toUpperCase();
  if (["SUCCESS", "FAILURE", "ABORTED", "UNSTABLE"].includes(result)) {
    return result;
  }
  if (state === "success") {
    return "SUCCESS";
  }
  if (state === "failure") {
    return "FAILURE";
  }
  return "";
}

function sanitizeAssetTypes(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_ASSET_TYPE_ROWS)
    .map((item) => ({
      assetType: cleanText(item?.assetType || item?.type || "Unknown", MAX_NAME_LENGTH),
      count: toInteger(item?.count || item?.assetCount) || 0,
      sizeBytes: toNonNegativeInteger(item?.sizeBytes || item?.bytes) || 0,
    }))
    .filter((item) => item.assetType);
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 4) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, MAX_METADATA_KEYS)) {
    const key = cleanText(rawKey, MAX_NAME_LENGTH);
    if (!key) {
      continue;
    }
    if (SECRET_KEY_PATTERN.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = sanitizeMetadataValue(rawValue, depth + 1);
  }

  return result;
}

function sanitizeMetadataValue(value, depth) {
  if (typeof value === "string") {
    return cleanText(value, MAX_TEXT_LENGTH);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadataValue(item, depth + 1));
  }
  if (typeof value === "object" && depth <= 4) {
    return sanitizeMetadata(value, depth);
  }
  return null;
}

function cleanName(value, fallback) {
  const cleaned = cleanText(value, MAX_NAME_LENGTH);
  return cleaned || fallback;
}

function cleanText(value, maxLength) {
  if (value === null || value === undefined) {
    return "";
  }

  let text = String(value)
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();

  if (SECRET_VALUE_PATTERN.test(text.toLowerCase())) {
    text = "[redacted]";
  }

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1)}...`;
  }

  return text;
}

function toInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNonNegativeInteger(value) {
  const parsed = toInteger(value);
  if (parsed === null || parsed < 0) {
    return null;
  }
  return parsed;
}

function createSummary(run, stages, bundles, assetTypes) {
  const totalBundles = Math.max(...bundles.map((bundle) => bundle.total_bundles || 0), bundles.length, 0);
  const completedBundles = bundles.filter((bundle) => bundle.state === "success" || bundle.state === "failure").length;
  const activeBundles = bundles.filter((bundle) => bundle.state === "running").length;
  const totalAssetBytes = assetTypes.reduce((total, item) => total + Number(item.size_bytes || 0), 0);

  return {
    stageCount: stages.length,
    completedStageCount: stages.filter((stage) => stage.finished_at).length,
    totalBundles,
    completedBundles,
    activeBundles,
    assetTypeCount: assetTypes.length,
    totalAssetBytes,
    totalDurationMs: durationFromRow(run.total_duration_ms, run.started_at, run.finished_at || run.updated_at),
  };
}

function createUnconfiguredSnapshot() {
  return {
    configured: false,
    source: "unconfigured",
    state: "unconfigured",
    result: "",
    runId: "",
    jobName: DEFAULT_JOB_NAME,
    buildNumber: null,
    currentStage: "",
    updatedAt: new Date().toISOString(),
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
  };
}

function createEmptySnapshot() {
  return {
    ...createUnconfiguredSnapshot(),
    configured: true,
    source: "postgres",
    state: "idle",
  };
}

function toRun(row) {
  return {
    runId: row.run_id,
    jobName: row.job_name,
    buildNumber: row.build_number,
    gitRef: row.git_ref || "",
    gitCommit: row.git_commit || "",
    buildTarget: row.build_target || "",
    packageName: row.package_name || "",
    state: row.state || "idle",
    result: row.result || "",
    currentStage: row.current_stage_name || "",
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    totalDurationMs: durationFromRow(row.total_duration_ms, row.started_at, row.finished_at || row.updated_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toStage(row) {
  return {
    stageId: row.stage_id,
    stageName: row.stage_name || row.stage_id,
    state: row.state || "running",
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    durationMs: durationFromRow(row.duration_ms, row.started_at, row.finished_at),
    metadata: row.metadata || {},
  };
}

function toBundle(row) {
  return {
    bundleName: row.bundle_name,
    state: row.state || "running",
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    durationMs: durationFromRow(row.duration_ms, row.started_at, row.finished_at),
    inputSizeBytes: Number(row.input_size_bytes || 0),
    sizeBytes: Number(row.size_bytes || 0),
    assetCount: row.asset_count,
    cached: row.cached,
    completedBundles: row.completed_bundles,
    totalBundles: row.total_bundles,
    metadata: row.metadata || {},
  };
}

function toAssetType(row) {
  return {
    assetType: row.asset_type,
    count: Number(row.asset_count || 0),
    sizeBytes: Number(row.size_bytes || 0),
  };
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : "";
}

function durationFromRow(durationMs, startedAt, finishedAt) {
  const explicit = Number(durationMs || 0);
  if (explicit > 0) {
    return explicit;
  }
  if (!startedAt || !finishedAt) {
    return 0;
  }

  const started = new Date(startedAt).getTime();
  const finished = new Date(finishedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    return 0;
  }

  return finished - started;
}
