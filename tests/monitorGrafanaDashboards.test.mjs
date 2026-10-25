import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const boards = ["overview", "trends", "infrastructure"].map((name) => JSON.parse(fs.readFileSync(
  new URL(`../services/server-monitor/grafana/dashboards/${name}.json`, import.meta.url), "utf8")));

test("the provisioned native dashboards are read-only and preserve source and refresh boundaries", () => {
  for (const [index, board] of boards.entries()) {
    assert.equal(board.uid, ["monitor-sre-overview", "monitor-sre-trends", "monitor-sre-infrastructure"][index]);
    assert.equal(board.editable, false);
    assert.equal(board.timezone, "Asia/Shanghai");
    assert.equal(board.refresh, index === 0 ? "3s" : "30s");
    const ids = board.panels.map((panel) => panel.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const panel of board.panels) for (const target of panel.targets) {
      assert.ok(["monitor-prometheus", "monitor-legacy-history"].includes(target.datasource.uid));
      assert.equal(Boolean(target.expr) + Boolean(target.rawSql), 1);
    }
  }
});

test("golden signal latency combines buckets and error percentages require observed traffic", () => {
  const overview = boards[0];
  for (const label of ["延迟", "流量", "错误", "饱和度"]) assert.ok(overview.panels.some((panel) => panel.title.startsWith(label)));
  const latency = overview.panels.find((panel) => panel.title.startsWith("延迟")).targets[0].expr;
  assert.match(latency, /histogram_quantile\(0\.95, sum by \(le\)/);
  assert.match(latency, /http_success_duration_seconds_bucket:rate5m/);
  const errors = overview.panels.find((panel) => panel.title.startsWith("错误")).targets[0].expr;
  assert.match(errors, /status=~"5\.\."/);
  assert.match(errors, /> 0/);
  assert.match(errors, /up\{job="server-monitor-http"/);
  assert.ok(overview.panels.some((panel) => panel.title === "失败请求 P95" && panel.targets[0].expr.includes("http_server_error_duration")));
});

test("historical graphs retain null gaps and only the restricted legacy resource view is queried", () => {
  let oldHistoryQueries = 0;
  for (const board of boards) for (const panel of board.panels) {
    if (panel.type === "timeseries") assert.equal(panel.fieldConfig.defaults.custom.spanNulls, false);
    for (const target of panel.targets) {
      if (!target.rawSql) continue;
      oldHistoryQueries++;
      assert.equal(target.datasource.uid, "monitor-legacy-history");
      assert.match(target.rawSql, /^SELECT /);
      assert.match(target.rawSql, /FROM public\.monitor_grafana_resource_history WHERE \$__timeFilter\(collected_at\)/);
      assert.doesNotMatch(target.rawSql, /monitor_samples|monitor_sessions|oauth|INSERT|UPDATE|DELETE|DROP|;/i);
      assert.doesNotMatch(panel.title, /请求|错误|延迟/);
    }
  }
  assert.equal(oldHistoryQueries, 3);
});

test("current process, host and container fields retain their identity and raw-frame guards", () => {
  const panels = boards[2].panels;
  const process = panels.find((panel) => panel.title === "进程 / 就绪检查").targets[0].expr;
  assert.match(process, /status="unhealthy"/);
  assert.match(process, /timestamp\(server_monitor_custom_service_info/);
  assert.doesNotMatch(process, /and on \(id\)/);
  const host = panels.find((panel) => panel.title === "CPU 使用率").targets[0].expr;
  assert.match(host, /timestamp\(server_monitor_host_cpu_percent/);
  assert.match(host, /timestamp\(server_monitor_host_collected_at_seconds/);
  const container = panels.find((panel) => panel.title === "容器内存 · working set").targets[0].expr;
  assert.match(container, /on \(host_id,container_id\) group_left \(name\)/);
  assert.match(container, /container_last_seen/);
});

test("HTTP recording aliases require a fresh atomic recording frame before aggregation", () => {
  let guarded = 0;
  for (const board of boards) for (const panel of board.panels) for (const target of panel.targets) {
    if (!/server_monitor:http_/.test(target.expr || "")) continue;
    guarded++;
    assert.match(target.expr, /scalar\(max\(timestamp\(server_monitor_http_recorded_at_seconds/);
    assert.match(target.expr, /max\(server_monitor_http_recorded_at_seconds.*?> time\(\) - 9/);
    assert.match(target.expr, /max\(timestamp\(server_monitor_http_recorded_at_seconds.*?> time\(\) - 9/);
    assert.doesNotMatch(target.expr, /last_over_time\(server_monitor:http_/);
    if (panel.type === "timeseries") {
      assert.equal(panel.interval, "$resolution");
      assert.equal(panel.fieldConfig.defaults.custom.spanNulls, false);
    }
  }
  assert.ok(guarded >= 15);
  const rules = fs.readFileSync(new URL("../services/server-monitor/http-sre.rules.yml", import.meta.url), "utf8");
  const records = [...rules.matchAll(/- record: (\S+)/g)].map((match) => match[1]);
  assert.equal(records.at(-1), "server_monitor_http_recorded_at_seconds");
});
