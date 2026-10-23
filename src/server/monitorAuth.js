import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import { ProxyAgent } from "undici";
import { ensureMonitorSchema, isMonitorDbConfigured, monitorPool } from "./monitorDb.js";

export const MONITOR_SESSION_COOKIE = "__Host-server-monitor-session";
export const MONITOR_OAUTH_COOKIE = "__Host-server-monitor-oauth";
export const MONITOR_SESSION_SECONDS = 24 * 60 * 60;
const OAUTH_SECONDS = 10 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function monitorAuthSettings() {
  const origin = process.env.MONITOR_PUBLIC_URL?.trim() || "https://warmhanser.com";
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("invalid_monitor_public_url");
  }
  return { origin: url.origin, callback: `${url.origin}/api/monitor/auth/google/callback`,
    clientId: process.env.MONITOR_GOOGLE_CLIENT_ID?.trim() || "",
    clientSecret: process.env.MONITOR_GOOGLE_CLIENT_SECRET?.trim() || "",
    ownerEmail: (process.env.MONITOR_OWNER_EMAIL?.trim() || "whanser220@gmail.com").toLowerCase(),
    proxyUrl: process.env.MONITOR_OAUTH_PROXY_URL?.trim() || "" };
}

export function isMonitorAuthConfigured() {
  try {
    const settings = monitorAuthSettings();
    return Boolean(settings.clientId && settings.clientSecret && isMonitorDbConfigured());
  } catch { return false; }
}

export function hashMonitorToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function safeMonitorTokenEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function readMonitorCookie(request, name) {
  const matches = (request.headers.get("cookie") || "").split(";")
    .map((item) => item.trim()).filter((item) => item.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return TOKEN_PATTERN.test(value) ? value : null;
}

export function setMonitorCookie(response, name, value, maxAge) {
  response.headers.append("Set-Cookie", `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`);
  return response;
}

export function clearMonitorOAuthCookie(response) {
  return setMonitorCookie(response, MONITOR_OAUTH_COOKIE, "", 0);
}

export function validateMonitorOwnerClaims(claims, ownerEmail = monitorAuthSettings().ownerEmail) {
  if (!claims || claims.email_verified !== true || typeof claims.email !== "string" ||
      claims.email.toLowerCase() !== ownerEmail || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) {
    throw new Error("access_denied");
  }
  return { subject: claims.sub, email: claims.email.toLowerCase() };
}

export function validMonitorSession(row, now = Date.now(), ownerEmail = monitorAuthSettings().ownerEmail) {
  return Boolean(row && row.email === ownerEmail && typeof row.subject === "string" && row.subject &&
    Number.isFinite(new Date(row.expires_at).getTime()) && new Date(row.expires_at).getTime() > now);
}

export async function readMonitorSession(request) {
  const token = readMonitorCookie(request, MONITOR_SESSION_COOKIE);
  if (!token || !isMonitorDbConfigured()) return null;
  await ensureMonitorSchema();
  const result = await monitorPool().query(`select subject, email, expires_at from monitor_sessions
    where token_hash = $1 and expires_at > now()`, [hashMonitorToken(token)]);
  const row = result.rows[0];
  return validMonitorSession(row) ? { subject: row.subject, email: row.email } : null;
}

async function googleConfiguration() {
  const settings = monitorAuthSettings();
  if (!isMonitorAuthConfigured()) throw new Error("monitor_not_configured");
  const key = hashMonitorToken(JSON.stringify(settings));
  const globalKey = "__personalHomepageMonitorGoogle";
  if (globalThis[globalKey]?.key !== key) {
    const entry = { key, promise: null };
    globalThis[globalKey] = entry;
    entry.promise = (async () => {
      const dispatcher = settings.proxyUrl ? new ProxyAgent(settings.proxyUrl) : null;
      const oauthFetch = (url, options = {}) => {
        const target = new URL(url instanceof Request ? url.url : url);
        if (target.protocol !== "https:" || !["accounts.google.com", "oauth2.googleapis.com", "www.googleapis.com"].includes(target.hostname)) {
          throw new Error("unexpected_oauth_endpoint");
        }
        const timeout = AbortSignal.timeout(10_000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        return fetch(url, { ...options, signal, ...(dispatcher ? { dispatcher } : {}) });
      };
      const config = await oidc.discovery(new URL("https://accounts.google.com"), settings.clientId, settings.clientSecret, undefined,
        { [oidc.customFetch]: oauthFetch, timeout: 10, execute: [oidc.enableNonRepudiationChecks] });
      config[oidc.customFetch] = oauthFetch;
      config.timeout = 10;
      return config;
    })().catch((error) => { if (globalThis[globalKey] === entry) delete globalThis[globalKey]; throw error; });
  }
  return globalThis[globalKey].promise;
}

export async function beginMonitorLogin(request) {
  const settings = monitorAuthSettings();
  const config = await googleConfiguration();
  await ensureMonitorSchema();
  const state = oidc.randomState();
  const browser = randomBytes(32).toString("base64url");
  const nonce = oidc.randomNonce();
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const previousBrowser = readMonitorCookie(request, MONITOR_OAUTH_COOKIE);
  if (previousBrowser) await monitorPool().query("delete from monitor_oauth_transactions where browser_hash = $1", [hashMonitorToken(previousBrowser)]);
  await monitorPool().query(`insert into monitor_oauth_transactions (state_hash, browser_hash, verifier, nonce, expires_at)
    values ($1, $2, $3, $4, now() + interval '10 minutes')`, [hashMonitorToken(state), hashMonitorToken(browser), verifier, nonce]);
  const url = oidc.buildAuthorizationUrl(config, { redirect_uri: settings.callback, scope: "openid email",
    code_challenge: challenge, code_challenge_method: "S256", state, nonce,
    login_hint: settings.ownerEmail, prompt: "select_account" });
  return { url: url.href, browser, maxAge: OAUTH_SECONDS };
}

export function monitorCallbackUrl(request) {
  const incoming = new URL(request.url);
  const callback = new URL(monitorAuthSettings().callback);
  callback.search = incoming.search;
  return callback;
}

export async function completeMonitorLogin(request) {
  const callback = monitorCallbackUrl(request);
  const state = callback.searchParams.get("state");
  const browser = readMonitorCookie(request, MONITOR_OAUTH_COOKIE);
  if (!state || !TOKEN_PATTERN.test(state) || !browser || callback.searchParams.getAll("state").length !== 1) {
    throw new Error("invalid_oauth_state");
  }
  await ensureMonitorSchema();
  // Consume before exchanging the code, making every callback single-use and bound to this browser.
  const transaction = await monitorPool().query(`delete from monitor_oauth_transactions
    where state_hash = $1 and browser_hash = $2 and expires_at > now() returning verifier, nonce`,
  [hashMonitorToken(state), hashMonitorToken(browser)]);
  if (!transaction.rowCount) throw new Error("invalid_oauth_state");
  const { verifier, nonce } = transaction.rows[0];
  const config = await googleConfiguration();
  const tokens = await oidc.authorizationCodeGrant(config, callback, {
    pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce, idTokenExpected: true,
  });
  const identity = validateMonitorOwnerClaims(tokens.claims());
  const token = randomBytes(32).toString("base64url");
  const previous = readMonitorCookie(request, MONITOR_SESSION_COOKIE);
  const client = await monitorPool().connect();
  try {
    await client.query("begin");
    if (previous) await client.query("delete from monitor_sessions where token_hash = $1", [hashMonitorToken(previous)]);
    await client.query(`insert into monitor_sessions (token_hash, subject, email, expires_at)
      values ($1, $2, $3, now() + interval '24 hours')`, [hashMonitorToken(token), identity.subject, identity.email]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
  return { token, ...identity };
}

export async function deleteMonitorSession(request) {
  const token = readMonitorCookie(request, MONITOR_SESSION_COOKIE);
  if (token && isMonitorDbConfigured()) {
    await ensureMonitorSchema();
    await monitorPool().query("delete from monitor_sessions where token_hash = $1", [hashMonitorToken(token)]);
  }
}

export function isMonitorSameOrigin(request) {
  return request.headers.get("origin") === monitorAuthSettings().origin;
}

export function isMonitorIngestAuthorized(request) {
  const expected = process.env.MONITOR_INGEST_TOKEN?.trim();
  const authorization = request.headers.get("authorization") || "";
  if (!expected || expected.length < 32 || !authorization.startsWith("Bearer ")) return false;
  // Next.js injects X-Forwarded-* even for direct requests. The credential is the
  // application trust boundary; the public reverse proxy separately blocks this route.
  // Do not infer the socket's origin from X-Forwarded-For (Docker may supply its bridge address).
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (request.headers.get("host") !== "127.0.0.1:3000" ||
      (forwardedHost && forwardedHost !== "127.0.0.1:3000") ||
      ["forwarded", "origin"].some((name) => request.headers.has(name))) return false;
  return safeMonitorTokenEqual(authorization.slice(7), expected);
}
