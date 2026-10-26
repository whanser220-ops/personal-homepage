#!/usr/bin/env node
// Exact API query regressions, with isolated synthetic Prometheus data.
// Run: node tests/verify_monitor_signals.mjs --promtool /path/to/promtool
// --write-fixture PATH also supports generating on one OS and testing on another.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorSignalsQuery } from "../src/server/monitorSignals.js";

const args = process.argv.slice(2), flag = args[0], destination = args[1];
if (args.length !== 2 || !["--promtool", "--write-fixture"].includes(flag)) throw new Error("Pass --promtool PATH or --write-fixture PATH");
const series = (metric, values, labels = {}) => ({ series: `${metric}{${Object.entries(labels).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(",")}}`, values });
const host = "cloud-primary";
const source = [series("up", "1+0x4", { job: "server-monitor-http", host_id: host }),
  series("server_monitor_http_recorded_at_seconds", "0+15x4", { job: "server-monitor-http", host_id: host })];
const requests = (status, value, values = `${value}+0x4`) => series("server_monitor:http_requests:rate1m", values, { service: "website", status });
const histogram = (failure, service, value, values) => ["1", "+Inf"].map((le) => series(
  failure ? "server_monitor:http_server_error_duration_seconds_bucket:rate5m" : "server_monitor:http_success_duration_seconds_bucket:rate5m",
  values || `${value}+0x4`, { service, le }));
const base = [...source, requests("200", 8), requests("500", 1), requests("404", 1),
  series("server_monitor:http_response_bytes:rate1m", "500+0x4", { service: "website", status: "200" }),
  ...histogram(false, "website", 9), ...histogram(true, "website", 1)];
const selected = (field, service = "all", metadata = false) => `(${monitorSignalsQuery(service, metadata)}) and on (monitor_field) label_replace(vector(1),"monitor_field","${field}","","")`;
const expected = (field, value) => ({ labels: `{monitor_field="${field}"}`, value });
const expression = (field, value, transform = (input) => input, service = "all", metadata = false) => ({
  expr: transform(selected(field, service, metadata)), eval_time: "1m", exp_samples: value === null ? [] : [expected(field, value)],
});
const testCase = (inputs, tests) => ({ interval: "15s", input_series: inputs, promql_expr_test: tests });
const cases = [];

cases.push(testCase(base, [expression("requestsPerSecond", 10), expression("serverErrorPercent", 10), expression("clientErrorPercent", 10),
  expression("successP95Ms", 950), expression("successP99Ms", 990), expression("failureP95Ms", 950), expression("failureP99Ms", 990),
  expression("responseBytesPerSecond", 500)]));

const orphan = [...source, requests("200", 9), requests("500", 1, "1+0x2 _x2"),
  ...["0.1", "1", "+Inf"].map((le) => series("server_monitor:http_success_duration_seconds_bucket:rate5m", "9+0x4", { service: "website", le })),
  ...["0.1", "1", "+Inf"].map((le) => series("server_monitor:http_success_duration_seconds_bucket:rate5m", `${le === "0.1" ? 0 : 100}+0x2 _x2`, { service: "whiteboard", le }))];
cases.push(testCase(orphan, [expression("requestsPerSecond", 9), expression("serverErrorPercent", 0),
  expression("successP95Ms", 1, (query) => `(${query}) < bool 100`), expression("failureP95Ms", null)]));

// Exporter up without any request is NoData, not a healthy zero.
cases.push(testCase(source, [{ expr: monitorSignalsQuery("all"), eval_time: "1m", exp_samples: [] }]));
cases.push(testCase([...source, requests("200", 0), requests("500", 0)], [expression("requestsPerSecond", 0),
  expression("serverErrorPercent", null), expression("clientErrorPercent", null)]));

const down = structuredClone(base);
down[0].values = "1+0x3 0";
cases.push(testCase(down, [{ expr: monitorSignalsQuery("all"), eval_time: "1m", exp_samples: [] }]));
const oldCapture = structuredClone(base);
oldCapture[1].values = "0+0x4";
cases.push(testCase(oldCapture, [{ expr: monitorSignalsQuery("all"), eval_time: "1m", exp_samples: [] }]));
const oldRecording = structuredClone(base);
oldRecording[1].values = "60+0x2 _x2";
cases.push(testCase(oldRecording, [{ expr: monitorSignalsQuery("all"), eval_time: "1m", exp_samples: [] }]));

// All-service latency combines weighted buckets rather than service quantiles.
const weighted = [...source, requests("200", 1),
  ...["0.1", "1", "+Inf"].map((le) => series("server_monitor:http_success_duration_seconds_bucket:rate5m", "99+0x4", { service: "website", le })),
  ...["0.1", "1", "+Inf"].map((le) => series("server_monitor:http_success_duration_seconds_bucket:rate5m", `${le === "0.1" ? 0 : 1}+0x4`, { service: "whiteboard", le }))];
cases.push(testCase(weighted, [expression("successP95Ms", 1, (query) => `(${query}) < bool 100`),
  expression("successP95Ms", 1, (query) => `(${query}) > bool 900`, "whiteboard")]));

const clocks = [expression("captureSeconds", 60, undefined, "all", true), expression("recordedSeconds", 60, undefined, "all", true),
  expression("exporterSeconds", 60, undefined, "all", true)];
for (const test of clocks) test.eval_time = "1m3s";
cases.push(testCase(source, clocks));
assert.equal(cases.length, 9);
const fixture = JSON.stringify({ rule_files: [], evaluation_interval: "3s", fuzzy_compare: true, tests: cases });
if (flag === "--write-fixture") {
  fs.writeFileSync(destination, fixture, "utf8");
  console.log(JSON.stringify({ fixture: destination, scenarios: cases.length }));
} else {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "monitor-signals-queries-"));
  try {
    const target = path.join(directory, "queries.json");
    fs.writeFileSync(target, fixture, "utf8");
    execFileSync(path.resolve(destination), ["test", "rules", target], { stdio: "inherit", timeout: 60_000 });
    console.log(JSON.stringify({ result: "passed", scenarios: cases.length }));
  } finally {
    const resolved = fs.realpathSync(directory);
    if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith("monitor-signals-queries-")) throw new Error("Unexpected query fixture cleanup path");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
