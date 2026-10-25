// Test-only preload for an isolated, unpublished candidate container.
// It must never be imported by the production website command.
import { createHash } from "node:crypto";

if (process.env.MONITOR_RUNTIME_PROBE !== "1" || process.env.HOSTNAME !== "127.0.0.1" ||
    process.env.DATABASE_URL !== "postgresql://fixture.invalid/noop" ||
    process.env.MONITOR_DATA_BACKEND !== "prometheus" ||
    ["MONITOR_GOOGLE_CLIENT_ID", "MONITOR_GOOGLE_CLIENT_SECRET", "MONITOR_INGEST_TOKEN", "BUILD_METRICS_INGEST_TOKEN"].some((key) => process.env[key])) {
  throw new Error("runtime_fixture_environment_rejected");
}

const tokenHash = createHash("sha256").update("r".repeat(43)).digest("hex");
const pool = {
  async query(sql, parameters = []) {
    const normalized = String(sql).replace(/\s+/g, " ").trim();
    if (normalized.startsWith("select subject, email, expires_at from monitor_sessions ") &&
        normalized.includes("where token_hash = $1 and expires_at > now()")) {
      return { rows: parameters.length === 1 && parameters[0] === tokenHash ? [{
        subject: "compiled-runtime-fixture-owner", email: process.env.MONITOR_OWNER_EMAIL,
        expires_at: new Date(Date.now() + 10 * 60_000),
      }] : [], rowCount: parameters[0] === tokenHash ? 1 : 0 };
    }
    if (normalized.startsWith("select to_timestamp(") && normalized.includes("from monitor_samples where host_id = $1") &&
        normalized.includes("group by 1 order by 1")) return { rows: [], rowCount: 0 };
    throw new Error("runtime_fixture_unexpected_database_query");
  },
  async connect() { throw new Error("runtime_fixture_database_writes_forbidden"); },
  on() {},
};

globalThis.__personalHomepageMonitorDb = {
  pool, schema: Promise.resolve(), cleanupAt: Number.POSITIVE_INFINITY, timer: {},
};
