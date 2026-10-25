import assert from "node:assert/strict";
import test from "node:test";
import { logMonitorReadFailure } from "../src/server/monitorHttp.js";

test("read diagnostics are bounded and never include arbitrary error text or URLs", (t) => {
  const previous = console.error, messages = [];
  console.error = (...args) => messages.push(args);
  t.after(() => { console.error = previous; });
  const error = new TypeError("password=never-log https://user:secret@example.com/query");
  error.code = "private-credential-never-log";
  error.stack = "TypeError: password=never-log\n at query (/app/.next/server/chunks/server.js:12:34)\n at https://secret.example/key";
  logMonitorReadFailure("current", error, 1000);
  logMonitorReadFailure("current", error, 2000);
  logMonitorReadFailure("invalid", error, 40000);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0][1], { operation: "current", name: "TypeError", message: "unknown", code: "unknown", location: "/app/.next/server/chunks/server.js:12:34" });
  logMonitorReadFailure("current", Object.assign(new Error("prometheus_unavailable"), { code: "ECONNRESET" }), 31000);
  assert.equal(messages.length, 2);
  assert.equal(messages[1][1].message, "prometheus_unavailable");
  assert.equal(messages[1][1].code, "ECONNRESET");
  assert.doesNotMatch(JSON.stringify(messages), /never-log|secret|credential|example/);
});
