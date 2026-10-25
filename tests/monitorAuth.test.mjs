import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { hashMonitorToken, isMonitorIngestAuthorized, isMonitorSameOrigin, MONITOR_OAUTH_COOKIE, MONITOR_SESSION_COOKIE,
  readMonitorCookie, safeMonitorTokenEqual, setMonitorCookie, validMonitorSession, validateMonitorOwnerClaims } from "../src/server/monitorAuth.js";
import { GET as startLogin } from "../app/api/monitor/auth/google/start/route.js";
import { GET as callbackLogin } from "../app/api/monitor/auth/google/callback/route.js";
import { GET as current } from "../app/api/monitor/current/route.js";
import { GET as history } from "../app/api/monitor/history/route.js";
import { POST as ingest } from "../app/api/monitor/ingest/route.js";
import { GET as sessionStatus } from "../app/api/monitor/auth/session/route.js";
import { POST as logout } from "../app/api/monitor/auth/logout/route.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "monitor-test", use: "sig", alg: "RS256" };
const baseUrl = "https://warmhanser.com";
const cookie = (name, value) => `${name}=${value}`;

function harness(t, options = {}) {
  const backup = Object.fromEntries(["DATABASE_URL", "MONITOR_GOOGLE_CLIENT_ID", "MONITOR_GOOGLE_CLIENT_SECRET", "MONITOR_PUBLIC_URL", "MONITOR_OWNER_EMAIL", "MONITOR_OAUTH_PROXY_URL", "MONITOR_DATA_BACKEND", "MONITOR_PROMETHEUS_URL", "MONITOR_PROMETHEUS_CUTOVER_AT", "MONITOR_INGEST_TOKEN"]
    .map((key) => [key, process.env[key]]));
  Object.assign(process.env, { DATABASE_URL: "postgresql://test.invalid/monitor", MONITOR_GOOGLE_CLIENT_ID: "monitor-client",
    MONITOR_GOOGLE_CLIENT_SECRET: "test-only-client-secret", MONITOR_PUBLIC_URL: baseUrl,
    MONITOR_OWNER_EMAIL: "whanser220@gmail.com", MONITOR_OAUTH_PROXY_URL: "", MONITOR_DATA_BACKEND: "postgres" });
  const previousDb = globalThis.__personalHomepageMonitorDb;
  const previousGoogle = globalThis.__personalHomepageMonitorGoogle;
  const previousFetch = globalThis.fetch;
  const transactions = new Map();
  const sessions = new Map();
  let tokenRequests = 0;
  let authorization;
  const query = async (sql, params = []) => {
    if (sql.includes("insert into monitor_oauth_transactions")) {
      transactions.set(params[0], { browserHash: params[1], verifier: params[2], nonce: params[3], expiresAt: Date.now() + 600_000 });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("delete from monitor_oauth_transactions") && sql.includes("state_hash")) {
      const item = transactions.get(params[0]);
      if (item && item.browserHash === params[1] && item.expiresAt > Date.now()) {
        transactions.delete(params[0]);
        return { rowCount: 1, rows: [{ verifier: item.verifier, nonce: item.nonce }] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes("insert into monitor_sessions")) {
      sessions.set(params[0], { subject: params[1], email: params[2], expires_at: new Date(Date.now() + 86400_000) });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("select subject, email, expires_at")) {
      const item = sessions.get(params[0]);
      return { rowCount: item ? 1 : 0, rows: item ? [item] : [] };
    }
    if (sql.includes("delete from monitor_sessions")) { sessions.delete(params[0]); return { rowCount: 1, rows: [] }; }
    if (sql.includes("select sample")) return { rowCount: 0, rows: [] };
    return { rowCount: 0, rows: [] };
  };
  globalThis.__personalHomepageMonitorDb = { pool: { query, connect: async () => ({ query, release() {} }) }, schema: Promise.resolve(), timer: {}, cleanupAt: Infinity };
  delete globalThis.__personalHomepageMonitorGoogle;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.includes(".well-known")) return Response.json({ issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", token_endpoint: "https://oauth2.googleapis.com/token",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs", response_types_supported: ["code"], subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_post"], code_challenge_methods_supported: ["S256"] });
    if (url.pathname === "/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    if (url.pathname === "/token") {
      tokenRequests += 1;
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("redirect_uri"), `${baseUrl}/api/monitor/auth/google/callback`);
      assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), authorization.searchParams.get("code_challenge"));
      const seconds = Math.floor(Date.now() / 1000);
      const claims = { iss: "https://accounts.google.com", aud: "monitor-client", sub: "google-subject-123",
        email: "whanser220@gmail.com", email_verified: true, iat: seconds, exp: seconds + 600,
        nonce: authorization.searchParams.get("nonce"), ...options.claims };
      const encoded = [Buffer.from(JSON.stringify({ alg: "RS256", kid: "monitor-test" })).toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url")].join(".");
      const signature = options.badSignature ? Buffer.alloc(256).toString("base64url") : sign("RSA-SHA256", Buffer.from(encoded), privateKey).toString("base64url");
      return Response.json({ access_token: "test-only-access-token", token_type: "Bearer", expires_in: 600, id_token: `${encoded}.${signature}` });
    }
    throw new Error("Unexpected test network request");
  };
  t.after(() => {
    for (const [key, value] of Object.entries(backup)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    globalThis.fetch = previousFetch;
    if (previousDb === undefined) delete globalThis.__personalHomepageMonitorDb; else globalThis.__personalHomepageMonitorDb = previousDb;
    if (previousGoogle === undefined) delete globalThis.__personalHomepageMonitorGoogle; else globalThis.__personalHomepageMonitorGoogle = previousGoogle;
  });
  return { sessions, transactions, get tokenRequests() { return tokenRequests; },
    async start() {
      const response = await startLogin(new Request(`${baseUrl}/api/monitor/auth/google/start`));
      assert.equal(response.status, 303);
      authorization = new URL(response.headers.get("location"));
      assert.equal(authorization.origin, "https://accounts.google.com");
      const binding = response.headers.getSetCookie()[0].split(";")[0];
      assert.match(binding, new RegExp(`^${MONITOR_OAUTH_COOKIE}=`));
      return { state: authorization.searchParams.get("state"), binding, authorization };
    },
    callback(state, binding) {
      return callbackLogin(new Request(`${baseUrl}/api/monitor/auth/google/callback?code=test-code&state=${state}`, { headers: { cookie: binding } }));
    } };
}

test("owner access requires a verified Google email and stable subject", () => {
  assert.deepEqual(validateMonitorOwnerClaims({ sub: "google-123", email: "whanser220@gmail.com", email_verified: true }), { subject: "google-123", email: "whanser220@gmail.com" });
  for (const changes of [{ email: "other@gmail.com" }, { email_verified: "true" }, { email_verified: false }, { sub: "" }]) {
    assert.throws(() => validateMonitorOwnerClaims({ sub: "google-123", email: "whanser220@gmail.com", email_verified: true, ...changes }), /access_denied/);
  }
  assert.equal(validMonitorSession({ subject: "google-123", email: "whanser220@gmail.com", expires_at: new Date(Date.now() - 1) }), false);
});

test("opaque cookies reject malformed and duplicate tokens and always use secure cookie attributes", () => {
  const token = "a".repeat(43);
  const req = (value) => new Request(baseUrl, { headers: { cookie: value } });
  assert.equal(readMonitorCookie(req(cookie(MONITOR_SESSION_COOKIE, token)), MONITOR_SESSION_COOKIE), token);
  assert.equal(readMonitorCookie(req(`${cookie(MONITOR_SESSION_COOKIE, token)}; ${cookie(MONITOR_SESSION_COOKIE, token)}`), MONITOR_SESSION_COOKIE), null);
  assert.equal(readMonitorCookie(req(cookie(MONITOR_SESSION_COOKIE, "forged")), MONITOR_SESSION_COOKIE), null);
  const response = setMonitorCookie(new Response(), MONITOR_SESSION_COOKIE, token, 86400);
  for (const value of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=86400"]) assert.ok(response.headers.get("set-cookie").includes(value));
  assert.equal(safeMonitorTokenEqual("same", "same"), true);
  assert.equal(safeMonitorTokenEqual("same", "wrong-length"), false);
});

test("ingest requires its independent credential and expected host while tolerating Next.js injected forwarding headers", (t) => {
  const previous = process.env.MONITOR_INGEST_TOKEN;
  process.env.MONITOR_INGEST_TOKEN = "a".repeat(48);
  t.after(() => { if (previous === undefined) delete process.env.MONITOR_INGEST_TOKEN; else process.env.MONITOR_INGEST_TOKEN = previous; });
  const req = (headers = {}) => new Request("http://127.0.0.1:3000/api/monitor/ingest", { headers: { host: "127.0.0.1:3000", authorization: `Bearer ${process.env.MONITOR_INGEST_TOKEN}`, ...headers } });
  assert.equal(isMonitorIngestAuthorized(req()), true);
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "172.20.0.1"]) {
    assert.equal(isMonitorIngestAuthorized(req({ "x-forwarded-for": address, "x-forwarded-host": "127.0.0.1:3000", "x-forwarded-proto": "http", "x-forwarded-port": "3000" })), true);
  }
  for (const headers of [{ authorization: "Bearer wrong" }, { host: "warmhanser.com" }, { "x-forwarded-host": "warmhanser.com" }, { forwarded: "for=127.0.0.1" }, { origin: baseUrl }]) {
    assert.equal(isMonitorIngestAuthorized(req(headers)), false);
  }
  assert.equal(isMonitorSameOrigin(new Request(baseUrl, { headers: { origin: "https://attacker.invalid" } })), false);
});

test("valid Google authorization verifies PKCE, nonce and signature, stores only a session hash, and supports revocation", async (t) => {
  const api = harness(t);
  const start = await api.start();
  for (const name of ["state", "nonce", "code_challenge"]) assert.ok(start.authorization.searchParams.get(name));
  assert.equal(start.authorization.searchParams.get("code_challenge_method"), "S256");
  const response = await api.callback(start.state, start.binding);
  assert.equal(response.headers.get("location"), `${baseUrl}/server-monitor`);
  const sessionCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${MONITOR_SESSION_COOKIE}=`)).split(";")[0];
  const rawToken = sessionCookie.slice(MONITOR_SESSION_COOKIE.length + 1);
  assert.ok(api.sessions.has(hashMonitorToken(rawToken)));
  assert.equal(api.sessions.has(rawToken), false);
  const status = await sessionStatus(new Request(`${baseUrl}/api/monitor/auth/session`, { headers: { cookie: sessionCookie } }));
  assert.deepEqual(await status.json(), { authenticated: true, configured: true, email: "whanser220@gmail.com" });
  const beforeLogout = await current(new Request(`${baseUrl}/api/monitor/current`, { headers: { cookie: sessionCookie } }));
  assert.equal(beforeLogout.status, 200);
  const snapshot = await beforeLogout.json();
  assert.equal(snapshot.sample, null);
  assert.equal(snapshot.stale, true);
  assert.ok(Math.abs(Date.parse(snapshot.serverTime) - Date.now()) < 1000);
  const rejected = await logout(new Request(`${baseUrl}/api/monitor/auth/logout`, { method: "POST", headers: { cookie: sessionCookie, origin: "https://attacker.invalid" } }));
  assert.equal(rejected.status, 403);
  const loggedOut = await logout(new Request(`${baseUrl}/api/monitor/auth/logout`, { method: "POST", headers: { cookie: sessionCookie, origin: baseUrl } }));
  assert.equal(loggedOut.status, 200);
  assert.equal(api.sessions.size, 0);
  assert.match(loggedOut.headers.getSetCookie()[0], /Max-Age=0/);
  assert.equal((await current(new Request(`${baseUrl}/api/monitor/current`, { headers: { cookie: sessionCookie } }))).status, 401);
  assert.match((await api.callback(start.state, start.binding)).headers.get("location"), /error=invalid_callback/);
  assert.equal(api.tokenRequests, 1, "a consumed callback must never exchange the code twice");
});

test("forged, wrong-browser and expired authorization states fail before token exchange", async (t) => {
  const api = harness(t);
  const start = await api.start();
  const invalid = await api.callback("z".repeat(43), start.binding);
  assert.match(invalid.headers.get("location"), /error=invalid_callback/);
  const wrongBrowser = await api.callback(start.state, cookie(MONITOR_OAUTH_COOKIE, "b".repeat(43)));
  assert.match(wrongBrowser.headers.get("location"), /error=invalid_callback/);
  api.transactions.get(hashMonitorToken(start.state)).expiresAt = Date.now() - 1;
  assert.match((await api.callback(start.state, start.binding)).headers.get("location"), /error=invalid_callback/);
  assert.equal(api.tokenRequests, 0);
  assert.equal(api.sessions.size, 0);
});

for (const [label, options] of [
  ["wrong email", { claims: { email: "other@gmail.com" } }],
  ["unverified email", { claims: { email_verified: false } }],
  ["wrong nonce", { claims: { nonce: "forged-nonce" } }],
  ["wrong audience", { claims: { aud: "another-client" } }],
  ["expired token", { claims: { exp: Math.floor(Date.now() / 1000) - 600 } }],
  ["invalid signature", { badSignature: true }],
]) {
  test(`Google login rejects ${label} and creates no session`, async (t) => {
    const api = harness(t, options);
    const start = await api.start();
    const response = await api.callback(start.state, start.binding);
    assert.match(response.headers.get("location"), /error=/);
    assert.equal(api.sessions.size, 0);
    assert.equal(response.headers.getSetCookie().some((value) => value.startsWith(`${MONITOR_SESSION_COOKIE}=`)), false);
  });
}

test("unauthenticated and expired sessions cannot read current or history; all results are no-store", async (t) => {
  const api = harness(t);
  const token = "e".repeat(43);
  api.sessions.set(hashMonitorToken(token), { subject: "google-123", email: "whanser220@gmail.com", expires_at: new Date(Date.now() - 1000) });
  for (const route of [current, history]) {
    for (const value of ["", cookie(MONITOR_SESSION_COOKIE, token)]) {
      const response = await route(new Request(`${baseUrl}/api/monitor/current`, { headers: { cookie: value } }));
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    }
  }
});

test("Prometheus backend preserves owner-only session checks and never falls back on backend failure", async (t) => {
  const api = harness(t);
  process.env.MONITOR_DATA_BACKEND = "prometheus";
  process.env.MONITOR_PROMETHEUS_URL = "http://8.8.8.8:19090"; // Invalid config fails before any network request.
  process.env.MONITOR_PROMETHEUS_CUTOVER_AT = new Date(Date.now() - 1000).toISOString();
  const expired = "e".repeat(43), wrongOwner = "w".repeat(43), owner = "o".repeat(43);
  api.sessions.set(hashMonitorToken(expired), { subject: "owner", email: "whanser220@gmail.com", expires_at: new Date(Date.now() - 1) });
  api.sessions.set(hashMonitorToken(wrongOwner), { subject: "other", email: "other@gmail.com", expires_at: new Date(Date.now() + 60_000) });
  api.sessions.set(hashMonitorToken(owner), { subject: "owner", email: "whanser220@gmail.com", expires_at: new Date(Date.now() + 60_000) });
  for (const route of [current, history]) {
    for (const token of ["", "forged", expired, wrongOwner]) {
      const response = await route(new Request(`${baseUrl}/api/monitor/current`, { headers: { cookie: cookie(MONITOR_SESSION_COOKIE, token) } }));
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
    const response = await route(new Request(`${baseUrl}/api/monitor/current`, { headers: { cookie: cookie(MONITOR_SESSION_COOKIE, owner) } }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "monitor_unavailable" });
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("Prometheus cutover retires authenticated ingestion without reading a body or writing PostgreSQL", async (t) => {
  harness(t);
  process.env.MONITOR_DATA_BACKEND = "prometheus";
  process.env.MONITOR_INGEST_TOKEN = "a".repeat(48);
  const request = new Request("http://127.0.0.1:3000/api/monitor/ingest", { method: "POST", headers: { host: "127.0.0.1:3000", authorization: `Bearer ${process.env.MONITOR_INGEST_TOKEN}` }, body: "not json" });
  const response = await ingest(request);
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { error: "ingest_retired" });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await ingest(new Request("http://127.0.0.1:3000/api/monitor/ingest", { method: "POST" }))).status, 401);
});
