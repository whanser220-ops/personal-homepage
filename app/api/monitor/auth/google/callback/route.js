import { clearMonitorOAuthCookie, completeMonitorLogin, MONITOR_SESSION_COOKIE, MONITOR_SESSION_SECONDS, monitorAuthSettings, setMonitorCookie } from "../../../../../../src/server/monitorAuth.js";
import { monitorRedirect } from "../../../../../../src/server/monitorHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const destination = `${monitorAuthSettings().origin}/server-monitor`;
  try {
    const session = await completeMonitorLogin(request);
    return clearMonitorOAuthCookie(setMonitorCookie(monitorRedirect(destination), MONITOR_SESSION_COOKIE, session.token, MONITOR_SESSION_SECONDS));
  } catch (error) {
    // Record only bounded error identifiers, never URLs, tokens, claims or responses.
    const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9_]{1,80}$/.test(value) ? value : "unknown";
    console.warn("Monitor Google callback rejected", {
      name: identifier(error?.name), code: identifier(error?.code),
      cause: identifier(error?.cause?.code),
      check: ["access_denied", "invalid_oauth_state"].includes(error?.message) ? error.message : "oidc_exchange",
    });
    const reason = error.message === "access_denied" ? "access_denied" : "invalid_callback";
    return clearMonitorOAuthCookie(monitorRedirect(`${destination}?error=${reason}`));
  }
}
