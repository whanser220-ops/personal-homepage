import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/monitor/auth/grafana/route.js";
import { MONITOR_SESSION_COOKIE } from "../src/server/monitorAuth.js";

const OWNER = "whanser220@gmail.com", TOKEN = "a".repeat(43);
function harness(t, row, error = false, owner = OWNER) {
  const oldDatabase = process.env.DATABASE_URL, oldOwner = process.env.MONITOR_OWNER_EMAIL;
  const previous = globalThis.__personalHomepageMonitorDb;
  process.env.DATABASE_URL = "postgresql://test.invalid/monitor";
  process.env.MONITOR_OWNER_EMAIL = owner;
  let queries = 0;
  globalThis.__personalHomepageMonitorDb = { schema: Promise.resolve(), timer: {}, cleanupAt: Infinity, pool: { query: async () => {
    queries++;
    if (error) throw new Error("private database credential must not be returned");
    return { rows: row ? [row] : [] };
  } } };
  t.after(() => {
    if (oldDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabase;
    if (oldOwner === undefined) delete process.env.MONITOR_OWNER_EMAIL; else process.env.MONITOR_OWNER_EMAIL = oldOwner;
    if (previous === undefined) delete globalThis.__personalHomepageMonitorDb; else globalThis.__personalHomepageMonitorDb = previous;
  });
  return { get queries() { return queries; } };
}
const ownerRow = () => ({ subject: "verified-google-subject", email: OWNER, expires_at: new Date(Date.now() + 86400_000) });
const request = (headers = {}) => new Request("https://warmhanser.com/api/monitor/auth/grafana", { headers });
function cacheHeaders(response) {
  assert.equal(response.headers.get("Cache-Control"), "no-store, private");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(response.headers.get("Vary"), "Cookie");
}

test("anonymous and forged proxy identity never authorize Grafana", async (t) => {
  const fixture = harness(t, ownerRow());
  for (const headers of [{}, { "X-Monitor-User": OWNER, "X-WEBAUTH-USER": OWNER }, { cookie: `${MONITOR_SESSION_COOKIE}=forged`, "X-Monitor-User": OWNER }]) {
    const response = await GET(request(headers));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("X-Monitor-User"), null);
    cacheHeaders(response);
  }
  assert.equal(fixture.queries, 0);
});

test("verified owner database session produces only the fixed trusted identity and an empty 204", async (t) => {
  harness(t, ownerRow());
  const response = await GET(request({ cookie: `${MONITOR_SESSION_COOKIE}=${TOKEN}`, "X-Monitor-User": "attacker@example.com" }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("X-Monitor-User"), OWNER);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Set-Cookie"), null);
  cacheHeaders(response);
});

test("missing, expired and wrong-owner sessions remain unauthorized", async (t) => {
  for (const [name, row, owner] of [["missing", null], ["expired", { ...ownerRow(), expires_at: new Date(Date.now() - 1) }],
    ["other owner", { ...ownerRow(), email: "other@example.com" }], ["owner setting cannot broaden Grafana access", { ...ownerRow(), email: "other@example.com" }, "other@example.com"]]) {
    await t.test(name, async (subtest) => {
      harness(subtest, row, false, owner);
      const response = await GET(request({ cookie: `${MONITOR_SESSION_COOKIE}=${TOKEN}` }));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("X-Monitor-User"), null);
      cacheHeaders(response);
    });
  }
});

test("duplicate cookies do not choose an arbitrary owner session", async (t) => {
  const fixture = harness(t, ownerRow());
  const response = await GET(request({ cookie: `${MONITOR_SESSION_COOKIE}=${TOKEN}; ${MONITOR_SESSION_COOKIE}=${TOKEN}` }));
  assert.equal(response.status, 401);
  assert.equal(fixture.queries, 0);
});

test("database failures close access with 503 and never return identity or exception contents", async (t) => {
  harness(t, null, true);
  const response = await GET(request({ cookie: `${MONITOR_SESSION_COOKIE}=${TOKEN}` }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("X-Monitor-User"), null);
  assert.deepEqual(await response.json(), { error: "monitor_unavailable" });
  cacheHeaders(response);
});
