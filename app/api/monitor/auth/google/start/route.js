import { beginMonitorLogin, isMonitorAuthConfigured, MONITOR_OAUTH_COOKIE, monitorAuthSettings, setMonitorCookie } from "../../../../../../src/server/monitorAuth.js";
import { monitorRedirect } from "../../../../../../src/server/monitorHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const destination = `${monitorAuthSettings().origin}/server-monitor`;
  if (!isMonitorAuthConfigured()) return monitorRedirect(`${destination}?error=not_configured`);
  try {
    const login = await beginMonitorLogin(request);
    return setMonitorCookie(monitorRedirect(login.url), MONITOR_OAUTH_COOKIE, login.browser, login.maxAge);
  } catch { return monitorRedirect(`${destination}?error=unavailable`); }
}
