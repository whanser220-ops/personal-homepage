// Opt in explicitly against the throwaway PostgreSQL SSH-forwarded on port
// 55438. Every table is created in a unique schema, never the public schema.
// Example (env values supplied by the operator):
// MONITOR_INTEGRATION_TEST=1 MONITOR_INTEGRATION_DATABASE_URL=... node --test tests/monitorDb.integration.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

const enabled = process.env.MONITOR_INTEGRATION_TEST === "1";

function integrationUrl() {
  const value = process.env.MONITOR_INTEGRATION_DATABASE_URL;
  assert.ok(value, "An explicit disposable integration database URL is required");
  const url = new URL(value);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1", "Only the disposable loopback SSH forward is allowed");
  assert.equal(url.port, "55438", "Refuse the production/default PostgreSQL port");
  assert.equal(url.pathname, "/postgres");
  assert.equal(url.username, "postgres");
  assert.equal(url.search, "", "Connection options must be created by this test only");
  assert.equal(url.hash, "");
  return url;
}

function sample(collectedAt = Date.now(), cpuPercent = 10) {
  return {
    hostId: "cloud-primary", collectedAt: new Date(collectedAt).toISOString(),
    host: {
      hostname: "integration-host",
      cpu: { percent: cpuPercent, load1: 0.1, load5: 0.2, load15: 0.3, cores: 2 },
      memory: { totalBytes: 2000, availableBytes: 1500, usedBytes: 500, usedPercent: 25 },
      swap: { totalBytes: 0, usedBytes: 0, usedPercent: 0 },
      disk: { mount: "/", totalBytes: 10000, usedBytes: 1000, availableBytes: 8000, usedPercent: 10, readBytesPerSecond: null, writeBytesPerSecond: null },
      network: { interface: "eth0", rxBytesPerSecond: null, txBytesPerSecond: null }, uptimeSeconds: 1000,
    }, containers: [], services: [],
  };
}

function hostOnly(collectedAt, cpuPercent = 10) {
  const value = sample(collectedAt, cpuPercent);
  delete value.containers;
  delete value.services;
  return value;
}

function checkedSample(collectedAt, checksCollectedAt, name) {
  const value = sample(collectedAt);
  value.checksCollectedAt = new Date(checksCollectedAt).toISOString();
  value.containers = [{ name, image: null, state: "running", health: "unknown", restartCount: 0,
    cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, memoryPercent: null }];
  value.services = [{ id: name, name, kind: "http", status: "reachable", latencyMs: 1, httpStatus: 303, detail: null }];
  return value;
}

test("monitor real PostgreSQL integration (explicit disposable database only)", { skip: !enabled, timeout: 60_000 }, async (t) => {
  // Validate before importing any production module, instantiating a pool, or
  // reading DATABASE_URL. No production env file is sourced by this harness.
  const baseUrl = integrationUrl();
  const { default: pg } = await import("pg");
  const schema = `server_monitor_it_${process.pid}_${randomBytes(6).toString("hex")}`;
  assert.match(schema, /^server_monitor_it_\d+_[a-f0-9]{12}$/);
  const admin = new pg.Client({ connectionString: baseUrl.href, connectionTimeoutMillis: 5000 });
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousOwner = process.env.MONITOR_OWNER_EMAIL;
  let db;
  let schemaCreated = false;
  try {
    await admin.connect();
    await admin.query(`create schema "${schema}"`);
    schemaCreated = true;
    const privateUrl = new URL(baseUrl);
    privateUrl.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = privateUrl.href;
    process.env.MONITOR_OWNER_EMAIL = "whanser220@gmail.com";
    db = await import("../src/server/monitorDb.js");
    const auth = await import("../src/server/monitorAuth.js");
    const { normalizeMonitorBatch, MONITOR_HISTORY_RANGES } = await import("../src/server/monitorValidation.js");
    await db.ensureMonitorSchema();
    assert.equal((await db.monitorPool().query("select current_schema() as schema")).rows[0].schema, schema);

    await t.test("real insert and overlapping replay deduplicate across batches", async () => {
      const now = Date.now();
      const samples = normalizeMonitorBatch({ samples: Array.from({ length: 24 }, (_, index) => sample(now - (24 - index) * 15_000, index)) }, now);
      assert.deepEqual(await db.writeMonitorSamples(samples.slice(0, 20)), { accepted: 20, inserted: 20, duplicates: 0 });
      assert.deepEqual(await db.writeMonitorSamples(samples.slice(16)), { accepted: 8, inserted: 4, duplicates: 4 });
      assert.deepEqual(await db.writeMonitorSamples(samples), { accepted: 24, inserted: 0, duplicates: 24 });
      assert.equal(Number((await db.monitorPool().query("select count(*) as count from monitor_samples")).rows[0].count), 24);
      const current = await db.readCurrentMonitorSample(now);
      assert.equal(current.sample.host.cpu.percent, 23);
      assert.equal(current.stale, false);
      assert.equal(current.checksStale, false);
      assert.equal((await db.readCurrentMonitorSample(now + 46_000)).stale, true);
    });

    await t.test("sparse rows merge newest host with newest captured checks without copying snapshots into storage", async () => {
      await db.monitorPool().query("truncate monitor_samples");
      const now = Date.now();
      const samples = normalizeMonitorBatch({ samples: [
        checkedSample(now - 9000, now - 12_000, "new-checks"),
        checkedSample(now - 3000, now - 30_000, "late-old-checks"),
        hostOnly(now, 88),
      ] }, now);
      await db.writeMonitorSamples(samples);
      assert.deepEqual(await db.writeMonitorSamples(samples), { accepted: 3, inserted: 0, duplicates: 3 });
      const stored = (await db.monitorPool().query("select sample from monitor_samples order by collected_at desc limit 1")).rows[0].sample;
      for (const key of ["containers", "services", "checksCollectedAt"]) assert.equal(Object.hasOwn(stored, key), false);
      const current = await db.readCurrentMonitorSample(now);
      assert.equal(current.sample.host.cpu.percent, 88);
      assert.equal(current.sample.collectedAt, new Date(now).toISOString());
      assert.equal(current.sample.checksCollectedAt, new Date(now - 12_000).toISOString());
      assert.equal(current.sample.containers[0].name, "new-checks");
      assert.equal(current.sample.services[0].httpStatus, 303);
      assert.equal(current.stale, false);
      assert.equal(current.checksStale, false);
      assert.equal((await db.readCurrentMonitorSample(now + 33_000)).checksStale, false, "exactly 45 seconds is still within the threshold");
      const aged = await db.readCurrentMonitorSample(now + 33_001);
      assert.equal(aged.stale, false);
      assert.equal(aged.checksStale, true);
    });

    await t.test("fresh host data does not refresh stale or missing checks", async () => {
      await db.monitorPool().query("truncate monitor_samples");
      const now = Date.now();
      await db.writeMonitorSamples(normalizeMonitorBatch({ samples: [checkedSample(now - 60_000, now - 70_000, "old-checks"), hostOnly(now)] }, now));
      const staleChecks = await db.readCurrentMonitorSample(now);
      assert.equal(staleChecks.stale, false);
      assert.equal(staleChecks.checksStale, true);
      assert.equal(staleChecks.sample.services[0].id, "old-checks");
      await db.monitorPool().query("truncate monitor_samples");
      await db.writeMonitorSamples(normalizeMonitorBatch(hostOnly(now), now));
      const missingChecks = await db.readCurrentMonitorSample(now);
      assert.equal(missingChecks.stale, false);
      assert.equal(missingChecks.checksStale, true);
      assert.equal(missingChecks.sample.checksCollectedAt, null);
      assert.deepEqual(missingChecks.sample.containers, []);
      assert.deepEqual(missingChecks.sample.services, []);
      await db.monitorPool().query("truncate monitor_samples");
      const empty = await db.readCurrentMonitorSample(now);
      assert.equal(empty.sample, null);
      assert.equal(empty.stale, true);
      assert.equal(empty.checksStale, true);
    });

    await t.test("pre-upgrade stored snapshots use their original time and retained checks expire independently", async () => {
      await db.monitorPool().query("truncate monitor_samples");
      const now = Date.now();
      // Bypass normalization to reproduce JSON stored before checksCollectedAt existed.
      const legacy = sample(now - 15_000);
      await db.monitorPool().query("insert into monitor_samples(host_id,collected_at,sample) values ($1,$2,$3)", [legacy.hostId, legacy.collectedAt, legacy]);
      await db.writeMonitorSamples(normalizeMonitorBatch(hostOnly(now), now));
      const current = await db.readCurrentMonitorSample(now);
      assert.equal(current.sample.checksCollectedAt, legacy.collectedAt);
      assert.equal(current.checksStale, false);
      assert.deepEqual(current.sample.services, []);
      await db.monitorPool().query("truncate monitor_samples");
      await db.writeMonitorSamples(normalizeMonitorBatch(checkedSample(now, now - 7 * 86400_000 + 2000, "expiring"), now));
      const expired = await db.readCurrentMonitorSample(now + 3000);
      assert.equal(expired.stale, false);
      assert.equal(expired.checksStale, true);
      assert.equal(expired.sample.checksCollectedAt, null);
      assert.deepEqual(expired.sample.containers, []);
    });

    for (const range of ["1h", "24h", "7d"]) {
      await t.test(`${range} history aggregates only observed points and preserves null gaps`, async () => {
        await db.monitorPool().query("truncate monitor_samples");
        const step = MONITOR_HISTORY_RANGES[range].intervalSeconds * 1000;
        const end = Math.floor(Date.now() / step) * step;
        const now = end + 3000;
        const samples = [hostOnly(end - 4 * step + 1000, 10), hostOnly(end - 2 * step + 1000, 30), hostOnly(end - 2 * step + 2000, 50)];
        await db.writeMonitorSamples(normalizeMonitorBatch({ samples }, now));
        const history = await db.readMonitorHistory(range, now);
        assert.equal(history.intervalSeconds * 1000, step);
        assert.equal(history.points.length, MONITOR_HISTORY_RANGES[range].durationSeconds / (step / 1000) + 1);
        const point = (offset) => history.points.find((item) => Date.parse(item.collectedAt) === end - offset * step);
        assert.equal(point(4).cpuPercent, 10);
        assert.equal(point(2).cpuPercent, 40);
        assert.equal(point(3).cpuPercent, null);
        assert.equal(point(2).rxBytesPerSecond, null);
        assert.equal(point(0).cpuPercent, null);
        assert.ok(history.points.length > 200);
      });
    }

    await t.test("seven-day housekeeping removes old samples and expired auth rows only", async () => {
      await db.monitorPool().query("truncate monitor_samples, monitor_sessions, monitor_oauth_transactions");
      const old = sample(Date.now() - 8 * 86400_000);
      const recent = sample(Date.now() - 60_000);
      await db.monitorPool().query(`insert into monitor_samples(host_id,collected_at,sample) values ($1,$2,$3),($4,$5,$6)`,
        [old.hostId, old.collectedAt, old, recent.hostId, recent.collectedAt, recent]);
      await db.monitorPool().query(`insert into monitor_sessions(token_hash,subject,email,expires_at) values
        ('expired','expired-sub','whanser220@gmail.com',now()-interval '1 minute'),
        ('valid','valid-sub','whanser220@gmail.com',now()+interval '1 hour')`);
      await db.monitorPool().query(`insert into monitor_oauth_transactions(state_hash,browser_hash,verifier,nonce,expires_at) values
        ('expired-state','browser','verifier','nonce',now()-interval '1 minute'),
        ('valid-state','browser','verifier','nonce',now()+interval '1 minute')`);
      globalThis.__personalHomepageMonitorDb.cleanupAt = 0;
      await db.monitorPool().query("update monitor_housekeeping set next_run_at=now()-interval '1 second'");
      await db.cleanupMonitorData();
      assert.equal(Number((await db.monitorPool().query("select count(*) as count from monitor_samples")).rows[0].count), 1);
      assert.deepEqual((await db.monitorPool().query("select subject from monitor_sessions")).rows.map((row) => row.subject), ["valid-sub"]);
      assert.deepEqual((await db.monitorPool().query("select state_hash from monitor_oauth_transactions")).rows.map((row) => row.state_hash), ["valid-state"]);
    });

    await t.test("hashed database sessions reject absent, expired, revoked, and other-owner cookies", async () => {
      await db.monitorPool().query("truncate monitor_sessions");
      const ownerToken = randomBytes(32).toString("base64url");
      const otherToken = randomBytes(32).toString("base64url");
      const expiredToken = randomBytes(32).toString("base64url");
      const request = (token) => new Request("https://warmhanser.com/api/monitor/current", { headers: token ? { cookie: `${auth.MONITOR_SESSION_COOKIE}=${token}` } : {} });
      await db.monitorPool().query(`insert into monitor_sessions(token_hash,subject,email,expires_at) values
        ($1,'google-owner-sub','whanser220@gmail.com',now()+interval '24 hours'),
        ($2,'other-sub','other@example.test',now()+interval '24 hours'),
        ($3,'expired-sub','whanser220@gmail.com',now()-interval '1 second')`,
      [auth.hashMonitorToken(ownerToken), auth.hashMonitorToken(otherToken), auth.hashMonitorToken(expiredToken)]);
      assert.deepEqual(await auth.readMonitorSession(request(ownerToken)), { subject: "google-owner-sub", email: "whanser220@gmail.com" });
      assert.equal(await auth.readMonitorSession(request()), null);
      assert.equal(await auth.readMonitorSession(request(otherToken)), null);
      assert.equal(await auth.readMonitorSession(request(expiredToken)), null);
      assert.equal(await auth.readMonitorSession(request(randomBytes(32).toString("base64url"))), null);
      await auth.deleteMonitorSession(request(ownerToken));
      assert.equal(await auth.readMonitorSession(request(ownerToken)), null);
      assert.equal(Number((await db.monitorPool().query("select count(*) as count from monitor_sessions where token_hash=$1", [ownerToken])).rows[0].count), 0);
    });

    await t.test("an interrupted connection in this test pool recovers without losing stored data", async () => {
      // Terminate only the PID returned by our private-schema pool. The container,
      // other clients, and root's concurrent Next.js ingest test keep running.
      const pid = (await db.monitorPool().query("select pg_backend_pid() as pid")).rows[0].pid;
      assert.ok(Number.isInteger(pid));
      await admin.query("select pg_terminate_backend($1)", [pid]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const recovered = await db.readCurrentMonitorSample();
      assert.equal(recovered.sample.hostId, "cloud-primary");
      assert.equal((await db.monitorPool().query("select current_schema() as schema")).rows[0].schema, schema);
    });
  } finally {
    const state = globalThis.__personalHomepageMonitorDb;
    if (state?.timer) clearInterval(state.timer);
    if (state?.pool) await state.pool.end();
    delete globalThis.__personalHomepageMonitorDb;
    if (schemaCreated) await admin.query(`drop schema "${schema}" cascade`);
    await admin.end();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousOwner === undefined) delete process.env.MONITOR_OWNER_EMAIL;
    else process.env.MONITOR_OWNER_EMAIL = previousOwner;
  }
});
