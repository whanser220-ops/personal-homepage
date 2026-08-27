import pg from "pg";

const { Pool } = pg;

const DEFAULT_JOB_NAME = process.env.BUILD_METRICS_JOB || "unity-linux-docker-build";
const MAX_TEXT_LENGTH = 2048;
const MAX_NAME_LENGTH = 256;
const MAX_METADATA_KEYS = 80;
const MAX_ASSET_TYPE_ROWS = 80;
const MAX_BUNDLE_MODULE_ROWS = 8;
const MAX_MODULE_BUNDLES = 120;
const MAX_REDUNDANT_ASSET_ROWS = 25;
const MAX_REDUNDANT_ASSET_BUNDLES = 16;
const SECRET_KEY_PATTERN = /(token|password|passwd|secret|authorization|credential|private[_-]?key|database_url)/i;
const SECRET_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._~+/=-]+|-----begin [a-z ]*private key-----|database_url=|api[_-]?token|ingest[_-]?token)/i;
const SCENE_MODULE_LABEL = "\u573a\u666f\u6a21\u5757";
const BUNDLE_MODULE_DEFINITIONS = [
  { key: "summer", label: "\u590f" },
  { key: "autumn", label: "\u79cb" },
  { key: "winter", label: "\u51ac" },
  { key: "common", label: "\u516c\u5171" },
];

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
  const [stageResult, bundleResult, assetTypeResult, bundleModuleResult, redundantAssetResult, recentRunResult] = await Promise.all([
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
      `select *
         from build_metric_bundle_modules
        where run_id = $1
        order by
          case module_key
            when 'summer' then 0
            when 'autumn' then 1
            when 'winter' then 2
            when 'common' then 3
            else 4
          end,
          module_key`,
      [run.run_id],
    ),
    pool.query(
      `select *
         from build_metric_redundant_assets
        where run_id = $1
        order by redundant_size_bytes desc, duplicate_count desc, asset_path
        limit 80`,
      [run.run_id],
    ),
    pool.query(
      `select run_id, job_name, build_number, git_ref, git_commit, build_target, package_name,
              state, result, current_stage_name, started_at, finished_at,
              total_duration_ms, metadata, updated_at
         from build_metric_runs
        order by updated_at desc
        limit 10`,
    ),
  ]);

  const bundles = bundleResult.rows.map(toBundle);
  const bundleModuleChildren =
    bundleModuleResult.rowCount > 0
      ? bundleModuleResult.rows.map(toBundleModule)
      : buildBundleModuleChildren(bundles);
  const redundantAssets = redundantAssetResult.rows.map(toRedundantAsset);

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
    bundles,
    assetTypes: assetTypeResult.rows.map(toAssetType),
    bundleModules: createBundleModuleTree(bundleModuleChildren),
    redundantAssets,
    recentRuns: recentRunResult.rows.map(toRun),
    summary: createSummary(run, stageResult.rows, bundleResult.rows, assetTypeResult.rows, redundantAssets),
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
    await upsertBundleModules(client, event);
    await upsertRedundantAssets(client, event);
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
  const terminal =
    event.eventType === "run_finished" ||
    event.eventType === "success" ||
    event.eventType === "failure" ||
    event.eventType === "stage_failed" ||
    event.eventType === "bundle_failed" ||
    event.state === "failure";
  const runState = terminal
    ? event.state || (event.eventType === "success" ? "success" : "failure")
    : "running";
  const runResult = terminal ? event.result : "";
  const startedAt = event.eventType === "run_started" || event.eventType === "stage_started" ? event.createdAt : null;
  const finishedAt = terminal ? event.createdAt : null;

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
       state = case
         when build_metric_runs.state in ('success', 'failure') and excluded.state = 'running'
           then build_metric_runs.state
         else excluded.state
       end,
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
      runState,
      runResult,
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

async function upsertBundleModules(client, event) {
  if (!event.bundleModulesProvided) {
    return;
  }

  await client.query("delete from build_metric_bundle_modules where run_id = $1", [event.runId]);
  for (const item of event.bundleModules) {
    await client.query(
      `insert into build_metric_bundle_modules (
         run_id, module_key, module_label, bundle_count, total_size_bytes,
         total_asset_count, bundles, updated_at
       )
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,now())
       on conflict (run_id, module_key) do update set
         module_label = excluded.module_label,
         bundle_count = excluded.bundle_count,
         total_size_bytes = excluded.total_size_bytes,
         total_asset_count = excluded.total_asset_count,
         bundles = excluded.bundles,
         updated_at = now()`,
      [
        event.runId,
        item.key,
        item.label,
        item.bundleCount,
        item.totalSizeBytes,
        item.totalAssetCount,
        JSON.stringify(item.bundles),
      ],
    );
  }
}

async function upsertRedundantAssets(client, event) {
  if (!event.redundantAssetsProvided) {
    return;
  }

  await client.query("delete from build_metric_redundant_assets where run_id = $1", [event.runId]);
  for (const item of event.redundantAssets) {
    await client.query(
      `insert into build_metric_redundant_assets (
         run_id, asset_path, asset_name, asset_type, duplicate_count,
         single_size_bytes, redundant_size_bytes, bundles, updated_at
       )
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
       on conflict (run_id, asset_path) do update set
         asset_name = excluded.asset_name,
         asset_type = excluded.asset_type,
         duplicate_count = excluded.duplicate_count,
         single_size_bytes = excluded.single_size_bytes,
         redundant_size_bytes = excluded.redundant_size_bytes,
         bundles = excluded.bundles,
         updated_at = now()`,
      [
        event.runId,
        item.assetPath,
        item.assetName,
        item.assetType,
        item.duplicateCount,
        item.singleSizeBytes,
        item.redundantSizeBytes,
        JSON.stringify(item.bundles),
      ],
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

      create table if not exists build_metric_bundle_modules (
        run_id text not null references build_metric_runs(run_id) on delete cascade,
        module_key text not null,
        module_label text not null default '',
        bundle_count integer not null default 0,
        total_size_bytes bigint not null default 0,
        total_asset_count integer not null default 0,
        bundles jsonb not null default '[]'::jsonb,
        updated_at timestamptz not null default now(),
        primary key (run_id, module_key)
      );

      create table if not exists build_metric_redundant_assets (
        run_id text not null references build_metric_runs(run_id) on delete cascade,
        asset_path text not null,
        asset_name text not null default '',
        asset_type text not null default '',
        duplicate_count integer not null default 0,
        single_size_bytes bigint not null default 0,
        redundant_size_bytes bigint not null default 0,
        bundles jsonb not null default '[]'::jsonb,
        updated_at timestamptz not null default now(),
        primary key (run_id, asset_path)
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
      create index if not exists build_metric_redundant_assets_run_size_idx
        on build_metric_redundant_assets (run_id, redundant_size_bytes desc);
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
  const metadata = sanitizeMetadata(source.metadata);
  const isBundleAnalysisSummary = eventType === "bundle_analysis_summary";
  const redundancySummary = isBundleAnalysisSummary ? sanitizeRedundancySummary(source.redundancySummary) : null;
  if (redundancySummary) {
    metadata.redundancySummary = redundancySummary;
  }

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
    metadata,
    assetTypes: sanitizeAssetTypes(source.assetTypes),
    bundleModules: isBundleAnalysisSummary ? sanitizeBundleModules(source.bundleModules) : [],
    bundleModulesProvided: isBundleAnalysisSummary && Array.isArray(source.bundleModules),
    redundantAssets: isBundleAnalysisSummary ? sanitizeRedundantAssets(source.redundantAssets) : [],
    redundantAssetsProvided: isBundleAnalysisSummary && Array.isArray(source.redundantAssets),
    redundancySummary,
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
    bundleModules: createBundleModuleTree(event.bundleModules),
    redundantAssets: event.redundantAssets,
    redundancySummary: event.redundancySummary || {},
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

function sanitizeBundleModules(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const rawChildren = [];
  for (const item of value) {
    if (Array.isArray(item?.children)) {
      rawChildren.push(...item.children);
    } else {
      rawChildren.push(item);
    }
  }

  return rawChildren
    .slice(0, MAX_BUNDLE_MODULE_ROWS)
    .map((item) => {
      const key = normalizeBundleModuleKey(item?.key || item?.moduleKey || item?.label || "");
      const bundles = sanitizeModuleBundles(item?.bundles);
      return {
        key,
        label: bundleModuleLabel(key, item?.label),
        bundleCount: toNonNegativeInteger(item?.bundleCount) ?? bundles.length,
        totalSizeBytes:
          toNonNegativeInteger(item?.totalSizeBytes ?? item?.sizeBytes) ??
          bundles.reduce((total, bundle) => total + Number(bundle.sizeBytes || 0), 0),
        totalAssetCount:
          toNonNegativeInteger(item?.totalAssetCount ?? item?.assetCount) ??
          bundles.reduce((total, bundle) => total + Number(bundle.assetCount || 0), 0),
        bundles,
      };
    })
    .filter((item) => item.key);
}

function sanitizeModuleBundles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_MODULE_BUNDLES)
    .map((item) => ({
      bundleName: cleanText(item?.bundleName || item?.name || "", MAX_NAME_LENGTH),
      sizeBytes: toNonNegativeInteger(item?.sizeBytes ?? item?.compressedSizeBytes ?? item?.inputSizeBytes) || 0,
      assetCount: toInteger(item?.assetCount) || 0,
    }))
    .filter((item) => item.bundleName);
}

function sanitizeRedundantAssets(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_REDUNDANT_ASSET_ROWS)
    .map((item) => {
      const assetPath = cleanText(item?.assetPath || item?.path || "", MAX_TEXT_LENGTH);
      return {
        assetPath,
        assetName: cleanText(item?.assetName || getAssetName(assetPath), MAX_NAME_LENGTH),
        assetType: cleanText(item?.assetType || "", MAX_NAME_LENGTH),
        duplicateCount: toNonNegativeInteger(item?.duplicateCount ?? item?.bundleCount) || 0,
        singleSizeBytes: toNonNegativeInteger(item?.singleSizeBytes ?? item?.buildSizeBytes) || 0,
        redundantSizeBytes: toNonNegativeInteger(item?.redundantSizeBytes) || 0,
        bundles: sanitizeRedundantAssetBundles(item?.bundles),
      };
    })
    .filter((item) => item.assetPath && item.duplicateCount > 1);
}

function sanitizeRedundantAssetBundles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_REDUNDANT_ASSET_BUNDLES)
    .map((item) => ({
      bundleName: cleanText(item?.bundleName || item?.name || "", MAX_NAME_LENGTH),
      copySizeBytes: toNonNegativeInteger(item?.copySizeBytes ?? item?.sizeBytes) || 0,
    }))
    .filter((item) => item.bundleName);
}

function sanitizeRedundancySummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    duplicateAssetCount: toNonNegativeInteger(value.duplicateAssetCount ?? value.count) || 0,
    totalRedundantSizeBytes:
      toNonNegativeInteger(value.totalRedundantSizeBytes ?? value.redundantSizeBytes) || 0,
  };
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

function createSummary(run, stages, bundles, assetTypes, redundantAssets = []) {
  const totalBundles = Math.max(...bundles.map((bundle) => bundle.total_bundles || 0), bundles.length, 0);
  const completedBundles = bundles.filter((bundle) => bundle.state === "success" || bundle.state === "failure").length;
  const activeBundles = bundles.filter((bundle) => bundle.state === "running").length;
  const totalAssetBytes = assetTypes.reduce((total, item) => total + Number(item.size_bytes || 0), 0);
  const redundancySummary = run.metadata?.redundancySummary || {};
  const duplicateAssetCount =
    toNonNegativeInteger(redundancySummary.duplicateAssetCount) ?? redundantAssets.length;
  const totalRedundantSizeBytes =
    toNonNegativeInteger(redundancySummary.totalRedundantSizeBytes) ??
    redundantAssets.reduce((total, item) => total + Number(item.redundantSizeBytes || 0), 0);

  return {
    stageCount: stages.length,
    completedStageCount: stages.filter((stage) => stage.finished_at).length,
    totalBundles,
    completedBundles,
    activeBundles,
    assetTypeCount: assetTypes.length,
    totalAssetBytes,
    duplicateAssetCount,
    totalRedundantSizeBytes,
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
    bundleModules: createBundleModuleTree([]),
    redundantAssets: [],
    recentRuns: [],
    summary: {
      stageCount: 0,
      completedStageCount: 0,
      totalBundles: 0,
      completedBundles: 0,
      activeBundles: 0,
      assetTypeCount: 0,
      totalAssetBytes: 0,
      duplicateAssetCount: 0,
      totalRedundantSizeBytes: 0,
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
  const metadata = row.metadata || {};
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
    metadata,
    revision: buildRunRevision(row, metadata),
  };
}

function buildRunRevision(row, metadata) {
  const p4 = metadata?.p4 && typeof metadata.p4 === "object" && !Array.isArray(metadata.p4)
    ? metadata.p4
    : {};
  const changelist = cleanText(p4.changelist || p4.change || p4.syncedChange || "", MAX_NAME_LENGTH);
  const pinnedChangelist = cleanText(p4.pinned_changelist || p4.pinnedChangelist || "", MAX_NAME_LENGTH);
  const stream = cleanText(p4.stream || "", MAX_NAME_LENGTH);
  const client = cleanText(p4.client || "", MAX_NAME_LENGTH);
  const user = cleanText(p4.user || "", MAX_NAME_LENGTH);
  const port = cleanText(p4.port || "", MAX_NAME_LENGTH);

  if (changelist || stream || client) {
    return {
      type: "perforce",
      label: changelist ? `P4 CL ${changelist}` : "Perforce",
      detail: [stream, client].filter(Boolean).join(" · "),
      changelist,
      pinnedChangelist,
      stream,
      client,
      user,
      port,
    };
  }

  const gitRef = row.git_ref || "";
  const gitCommit = row.git_commit || "";
  return {
    type: gitRef || gitCommit ? "git" : "unknown",
    label: gitCommit ? `Git ${gitCommit}` : gitRef || "版本未知",
    detail: gitRef || "",
    gitRef,
    gitCommit,
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

function toBundleModule(row) {
  return {
    key: normalizeBundleModuleKey(row.module_key),
    label: bundleModuleLabel(row.module_key, row.module_label),
    bundleCount: Number(row.bundle_count || 0),
    totalSizeBytes: Number(row.total_size_bytes || 0),
    totalAssetCount: Number(row.total_asset_count || 0),
    bundles: Array.isArray(row.bundles) ? row.bundles : [],
  };
}

function toRedundantAsset(row) {
  return {
    assetPath: row.asset_path,
    assetName: row.asset_name || getAssetName(row.asset_path),
    assetType: row.asset_type || "",
    duplicateCount: Number(row.duplicate_count || 0),
    singleSizeBytes: Number(row.single_size_bytes || 0),
    redundantSizeBytes: Number(row.redundant_size_bytes || 0),
    bundles: Array.isArray(row.bundles) ? row.bundles : [],
  };
}

function createBundleModuleTree(children) {
  return [
    {
      key: "scene",
      label: SCENE_MODULE_LABEL,
      children: mergeBundleModuleChildren(children),
    },
  ];
}

function mergeBundleModuleChildren(children) {
  const byKey = new Map(
    BUNDLE_MODULE_DEFINITIONS.map((definition) => [
      definition.key,
      {
        key: definition.key,
        label: definition.label,
        bundleCount: 0,
        totalSizeBytes: 0,
        totalAssetCount: 0,
        bundles: [],
      },
    ]),
  );

  for (const child of children || []) {
    const key = normalizeBundleModuleKey(child?.key || child?.label || "");
    const current = byKey.get(key);
    if (!current) {
      continue;
    }

    current.label = bundleModuleLabel(key, child.label);
    current.bundleCount = toNonNegativeInteger(child.bundleCount) ?? current.bundleCount;
    current.totalSizeBytes = toNonNegativeInteger(child.totalSizeBytes) ?? current.totalSizeBytes;
    current.totalAssetCount = toNonNegativeInteger(child.totalAssetCount) ?? current.totalAssetCount;
    current.bundles = Array.isArray(child.bundles) ? child.bundles : current.bundles;
  }

  return BUNDLE_MODULE_DEFINITIONS.map((definition) => byKey.get(definition.key));
}

function buildBundleModuleChildren(bundles) {
  const byKey = new Map(
    BUNDLE_MODULE_DEFINITIONS.map((definition) => [
      definition.key,
      {
        key: definition.key,
        label: definition.label,
        bundleCount: 0,
        totalSizeBytes: 0,
        totalAssetCount: 0,
        bundles: [],
      },
    ]),
  );

  for (const bundle of bundles || []) {
    const key = classifyBundleModule(bundle.bundleName);
    const module = byKey.get(key) || byKey.get("common");
    const sizeBytes = Number(bundle.sizeBytes || bundle.inputSizeBytes || 0);
    const assetCount = Number(bundle.assetCount || 0);
    module.bundles.push({
      bundleName: bundle.bundleName,
      sizeBytes,
      assetCount,
    });
    module.bundleCount += 1;
    module.totalSizeBytes += sizeBytes;
    module.totalAssetCount += assetCount;
  }

  for (const module of byKey.values()) {
    module.bundles.sort((left, right) => right.sizeBytes - left.sizeBytes || left.bundleName.localeCompare(right.bundleName));
  }

  return BUNDLE_MODULE_DEFINITIONS.map((definition) => byKey.get(definition.key));
}

function classifyBundleModule(bundleName) {
  const normalized = String(bundleName || "").toLowerCase();
  if (normalized.includes("summer")) {
    return "summer";
  }
  if (normalized.includes("autumn")) {
    return "autumn";
  }
  if (normalized.includes("winter")) {
    return "winter";
  }
  return "common";
}

function normalizeBundleModuleKey(value) {
  const normalized = cleanText(value || "", MAX_NAME_LENGTH).toLowerCase();
  if (normalized === "summer" || normalized === "\u590f") {
    return "summer";
  }
  if (normalized === "autumn" || normalized === "\u79cb") {
    return "autumn";
  }
  if (normalized === "winter" || normalized === "\u51ac") {
    return "winter";
  }
  if (normalized === "common" || normalized === "shared" || normalized === "\u516c\u5171") {
    return "common";
  }
  return classifyBundleModule(normalized);
}

function bundleModuleLabel(key, fallback) {
  const definition = BUNDLE_MODULE_DEFINITIONS.find((item) => item.key === normalizeBundleModuleKey(key));
  return definition?.label || cleanText(fallback || "", MAX_NAME_LENGTH) || key;
}

function getAssetName(assetPath) {
  const text = cleanText(assetPath || "", MAX_TEXT_LENGTH).replace(/\\/g, "/");
  const index = text.lastIndexOf("/");
  return index >= 0 ? text.slice(index + 1) : text;
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
