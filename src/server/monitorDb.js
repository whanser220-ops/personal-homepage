import pg from "pg";
import { buildMonitorHistoryPoints, MONITOR_HISTORY_RANGES, MONITOR_HOST_ID, MONITOR_RETENTION_MS } from "./monitorValidation.js";

const { Pool } = pg;
const GLOBAL_KEY = "__personalHomepageMonitorDb";

function state() {
  return globalThis[GLOBAL_KEY] ||= { pool: null, schema: null, cleanupAt: 0, timer: null };
}

export function isMonitorDbConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function monitorPool() {
  if (!isMonitorDbConfigured()) throw new Error("monitor_not_configured");
  if (!state().pool) {
    state().pool = new Pool({ connectionString: process.env.DATABASE_URL.trim(), max: 3,
      idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5000, statement_timeout: 10_000,
      application_name: "personal-homepage-monitor" });
    // A dropped idle connection must not terminate the website process or expose connection details.
    state().pool.on("error", () => {});
  }
  return state().pool;
}

export async function ensureMonitorSchema() {
  const current = state();
  if (!current.schema) {
    current.schema = monitorPool().query(`
      create table if not exists monitor_samples (
        host_id text not null, collected_at timestamptz not null,
        sample jsonb not null, received_at timestamptz not null default now(),
        primary key (host_id, collected_at)
      );
      create index if not exists monitor_samples_collected_at_idx on monitor_samples (collected_at);
      create index if not exists monitor_samples_checks_idx on monitor_samples
        (host_id, (coalesce(sample->>'checksCollectedAt', sample->>'collectedAt')) desc, collected_at desc)
        where sample ? 'containers' and sample ? 'services';
      create table if not exists monitor_sessions (
        token_hash text primary key, subject text not null, email text not null,
        created_at timestamptz not null default now(), expires_at timestamptz not null
      );
      create index if not exists monitor_sessions_expires_at_idx on monitor_sessions (expires_at);
      create table if not exists monitor_oauth_transactions (
        state_hash text primary key, browser_hash text not null,
        verifier text not null, nonce text not null, expires_at timestamptz not null
      );
      create index if not exists monitor_oauth_expires_at_idx on monitor_oauth_transactions (expires_at);
      create table if not exists monitor_housekeeping (name text primary key, next_run_at timestamptz not null);
    `).catch((error) => { current.schema = null; throw error; });
  }
  await current.schema;
  if (!current.timer) {
    current.timer = setInterval(() => { cleanupMonitorData().catch(() => {}); }, 60 * 60 * 1000);
    current.timer.unref?.();
  }
}

export async function cleanupMonitorData() {
  const current = state();
  if (current.cleanupAt > Date.now()) return;
  await ensureMonitorSchema();
  const client = await monitorPool().connect();
  try {
    await client.query("begin");
    const claimed = await client.query(`insert into monitor_housekeeping (name, next_run_at)
      values ('retention', now() + interval '1 hour') on conflict (name) do update
      set next_run_at = excluded.next_run_at where monitor_housekeeping.next_run_at <= now() returning name`);
    if (claimed.rowCount) {
      await client.query("delete from monitor_samples where collected_at < now() - interval '7 days'");
      await client.query("delete from monitor_sessions where expires_at <= now()");
      await client.query("delete from monitor_oauth_transactions where expires_at <= now()");
    }
    await client.query("commit");
    current.cleanupAt = Date.now() + 60 * 60 * 1000;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

export async function writeMonitorSamples(samples) {
  await ensureMonitorSchema();
  const result = await monitorPool().query(`insert into monitor_samples (host_id, collected_at, sample)
    select item->>'hostId', (item->>'collectedAt')::timestamptz, item
    from jsonb_array_elements($1::jsonb) as item
    on conflict (host_id, collected_at) do nothing`, [JSON.stringify(samples)]);
  await cleanupMonitorData();
  return { accepted: samples.length, inserted: result.rowCount, duplicates: samples.length - result.rowCount };
}

export async function readCurrentMonitorSample(now = Date.now()) {
  await ensureMonitorSchema();
  const retainedFrom = new Date(now - MONITOR_RETENTION_MS);
  // Keep sparse samples in storage. The partial index skips host-only rows;
  // canonical UTC ISO strings sort by capture time, including legacy rows.
  // One statement gives host and checks a consistent database snapshot.
  const result = await monitorPool().query(`select latest.sample, checks.sample as checks
    from (select sample from monitor_samples where host_id = $1 and collected_at >= $2
      order by collected_at desc limit 1) latest
    left join lateral (select sample from monitor_samples where host_id = $1 and collected_at >= $2
      and sample ? 'containers' and sample ? 'services'
      and coalesce(sample->>'checksCollectedAt', sample->>'collectedAt') >= $3
      order by coalesce(sample->>'checksCollectedAt', sample->>'collectedAt') desc, collected_at desc limit 1
    ) checks on true`, [MONITOR_HOST_ID, retainedFrom, retainedFrom.toISOString()]);
  const latest = result.rows[0]?.sample || null, checks = result.rows[0]?.checks || null;
  const checksCollectedAt = checks ? (checks.checksCollectedAt || checks.collectedAt) : null;
  const sample = latest ? { ...latest, containers: checks?.containers || [], services: checks?.services || [], checksCollectedAt } : null;
  return { sample, stale: !sample || now - Date.parse(sample.collectedAt) > 45_000,
    checksStale: !checksCollectedAt || now - Date.parse(checksCollectedAt) > 45_000,
    serverTime: new Date(now).toISOString() };
}

export async function readMonitorHistoryRows(range, now = Date.now(), { before = null } = {}) {
  const definition = MONITOR_HISTORY_RANGES[range];
  if (!definition) throw new Error("invalid_range");
  await ensureMonitorSchema();
  const step = definition.intervalSeconds;
  const start = Math.floor(now / (step * 1000)) * step * 1000 - definition.durationSeconds * 1000;
  const result = await monitorPool().query(`select
    to_timestamp(floor(extract(epoch from collected_at) / $2) * $2) as "collectedAt",
    avg((sample #>> '{host,cpu,percent}')::double precision) as "cpuPercent",
    avg((sample #>> '{host,memory,usedPercent}')::double precision) as "memoryPercent",
    avg((sample #>> '{host,swap,usedPercent}')::double precision) as "swapPercent",
    avg((sample #>> '{host,disk,usedPercent}')::double precision) as "diskPercent",
    avg((sample #>> '{host,disk,readBytesPerSecond}')::double precision) as "diskReadBytesPerSecond",
    avg((sample #>> '{host,disk,writeBytesPerSecond}')::double precision) as "diskWriteBytesPerSecond",
    avg((sample #>> '{host,network,rxBytesPerSecond}')::double precision) as "rxBytesPerSecond",
    avg((sample #>> '{host,network,txBytesPerSecond}')::double precision) as "txBytesPerSecond",
    count(sample #>> '{host,cpu,percent}') as "cpuPercentCount",
    count(sample #>> '{host,memory,usedPercent}') as "memoryPercentCount",
    count(sample #>> '{host,swap,usedPercent}') as "swapPercentCount",
    count(sample #>> '{host,disk,usedPercent}') as "diskPercentCount",
    count(sample #>> '{host,disk,readBytesPerSecond}') as "diskReadBytesPerSecondCount",
    count(sample #>> '{host,disk,writeBytesPerSecond}') as "diskWriteBytesPerSecondCount",
    count(sample #>> '{host,network,rxBytesPerSecond}') as "rxBytesPerSecondCount",
    count(sample #>> '{host,network,txBytesPerSecond}') as "txBytesPerSecondCount"
    from monitor_samples where host_id = $1 and collected_at >= $3 and collected_at <= $4
    and ($5::timestamptz is null or collected_at < $5::timestamptz)
    group by 1 order by 1`, [MONITOR_HOST_ID, step, new Date(start), new Date(now), before === null ? null : new Date(before)]);
  return result.rows;
}

export async function readMonitorHistory(range, now = Date.now()) {
  return buildMonitorHistoryPoints(await readMonitorHistoryRows(range, now), range, now);
}
