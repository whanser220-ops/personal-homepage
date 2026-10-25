#!/usr/bin/env python3
"""Run dashboard PromQL through a real promtool with isolated synthetic data.

Usage: python3 tests/verify_grafana_queries.py --promtool /path/to/promtool
Reads the actual provisioned JSON, never a duplicated expression. No network,
credentials, production TSDB, WSL paths, or external fixture files are needed.
"""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
DASHBOARDS = REPO / 'services/server-monitor/grafana/dashboards'


def expand(expression):
    return expression.replace('$service', '.*').replace('$__interval', '15s').replace('$resolution', '3s')


def panels(board):
    for panel in board.get('panels', []):
        yield panel
        # Also cover targets in a future collapsed Grafana row.
        if panel.get('panels'):
            yield from panels(panel)


def dashboard_query(boards, title, ref='A', board='infrastructure'):
    selected = [panel for panel in panels(boards[board]) if panel.get('title') == title]
    if len(selected) != 1:
        raise RuntimeError('Expected one dashboard panel: ' + title)
    targets = [target for target in selected[0].get('targets', []) if target.get('refId') == ref]
    if len(targets) != 1 or not targets[0].get('expr'):
        raise RuntimeError('Expected one PromQL target for panel: ' + title)
    return expand(targets[0]['expr'])


def series(metric, values, **labels):
    return {'series': metric + '{' + ','.join(key + '=' + json.dumps(value) for key, value in labels.items()) + '}',
            'values': values}


def expected(value, **labels):
    return {'labels': '{' + ','.join(key + '=' + json.dumps(value) for key, value in sorted(labels.items())) + '}',
            'value': value}


def case(inputs, expression, samples):
    return {'interval': '15s', 'input_series': inputs,
            'promql_expr_test': [{'expr': expression, 'eval_time': '1m', 'exp_samples': samples}]}


def build_cases(boards):
    host = 'cloud-primary'
    base = [series('up', '1+0x4', job=job, host_id=host)
            for job in ['server-monitor-cadvisor', 'server-monitor-custom', 'server-monitor-node']]
    base += [series('server_monitor_custom_collected_at_seconds', '0+15x4', job='server-monitor-custom', host_id=host),
             series('server_monitor_host_collected_at_seconds', '0+15x4', job='server-monitor-host', host_id=host),
             series('server_monitor_host_memory_total_bytes', '1073741824+0x4', job='server-monitor-host', host_id=host)]
    names = ['personal-homepage', 'learning-whiteboard', 'personal-homepage-postgres']
    identities = ['a' * 64, 'b' * 64, 'c' * 64]
    for name, identity, limit in zip(names, identities, [0, 536870912, 2147483648]):
        base.append(series('server_monitor_custom_container_info', '1+0x4', job='server-monitor-custom', host_id=host,
                           name=name, container_id=identity, state='running', health='healthy', image='fixture'))
        for metric, values in [('container_memory_working_set_bytes', '268435456+0x4'),
                               ('container_spec_memory_limit_bytes', str(limit) + '+0x4'),
                               ('container_last_seen', '0+15x4'), ('container_cpu_usage_seconds_total', '0+15x4')]:
            base.append(series(metric, values, job='server-monitor-cadvisor', host_id=host,
                               id='/system.slice/docker-' + identity + '.scope', name=name))

    # 256 MiB working set on a 1 GiB host. Unlimited/512 MiB/2 GiB limits
    # become effective 1 GiB/512 MiB/1 GiB, including the zero-limit fallback.
    cases = [case(base, dashboard_query(boards, '容器内存 / 有效上限'),
                  [expected(value, host_id=host, container_id=identity, name=name)
                   for identity, name, value in zip(identities, names, [25, 50, 25])])]

    # Three cases: a failed current cAdvisor scrape cannot replay any resource.
    failed = copy.deepcopy(base)
    for row in failed:
        if row['series'].startswith('up{job="server-monitor-cadvisor"'):
            row['values'] = '1+0x3 0'
    for title in ['容器 CPU · 1 分钟速率', '容器内存 · working set', '容器内存 / 有效上限']:
        cases.append(case(failed, dashboard_query(boards, title), []))

    # The old healthy labelset intentionally has NO stale marker. Only the
    # current unhealthy metadata may contribute, so the displayed state is 0.
    process = copy.deepcopy(base[:6])
    process += [series('server_monitor_custom_service_info', '1+0x2 _x2', job='server-monitor-custom', host_id=host,
                       id='postgres', name='PostgreSQL', kind='process', status='healthy', detail='old'),
                series('server_monitor_custom_service_info', '_x3 1+0x1', job='server-monitor-custom', host_id=host,
                       id='postgres', name='PostgreSQL', kind='process', status='unhealthy', detail='new')]
    cases.append(case(process, dashboard_query(boards, '进程 / 就绪检查'), [expected(0, id='postgres', name='PostgreSQL')]))

    # Fresh capture/up markers cannot resurrect an omitted host gauge or PSI.
    omitted = copy.deepcopy(base[:6])
    omitted.append(series('server_monitor_host_cpu_percent', '20+0x3 _', job='server-monitor-host', host_id=host))
    cases.append(case(omitted, dashboard_query(boards, 'CPU 使用率'), []))
    pressure = copy.deepcopy(base[:6])
    pressure.append(series('node_pressure_cpu_waiting_seconds_total', '0+3x3 _', job='server-monitor-node', host_id=host))
    cases.append(case(pressure, dashboard_query(boards, 'CPU / 内存 / IO 等待压力'), []))

    # A new full ID with the same name has no resource sample yet. The old
    # container's still-visible measurements must not attach to its replacement.
    recreated = copy.deepcopy(base)
    for row in recreated:
        if row['series'].startswith('server_monitor_custom_container_info{') and 'name="personal-homepage"' in row['series']:
            row['series'] = row['series'].replace('container_id="' + identities[0] + '"', 'container_id="' + 'd' * 64 + '"')
    cases.append(case(recreated, dashboard_query(boards, '容器内存 / 有效上限'),
                      [expected(value, host_id=host, container_id=identity, name=name)
                       for identity, name, value in zip(identities[1:], names[1:], [50, 25])]))

    # Recording rules themselves can leave old labelsets after a Prometheus
    # restart. Old 5xx and another service's old latency buckets must not join
    # the current complete recording frame, even while the exporter is up.
    http = [series('up', '1+0x4', job='server-monitor-http', host_id=host),
            series('server_monitor_http_recorded_at_seconds', '0+15x4', job='server-monitor-http', host_id=host),
            series('server_monitor:http_requests:rate1m', '9+0x4', service='website', status='200'),
            series('server_monitor:http_requests:rate1m', '1+0x2 _x2', service='website', status='500')]
    for bound in ['0.1', '1', '+Inf']:
        http.append(series('server_monitor:http_success_duration_seconds_bucket:rate5m', '9+0x4', service='website', le=bound))
        http.append(series('server_monitor:http_success_duration_seconds_bucket:rate5m',
                           ('0' if bound == '0.1' else '100') + '+0x2 _x2', service='whiteboard', le=bound))
    orphan = case(http, dashboard_query(boards, '错误 · 服务端 5xx', board='overview'), [expected(0)])
    orphan['promql_expr_test'] += [
        {'expr': dashboard_query(boards, '流量 · 每秒请求', board='overview'), 'eval_time': '1m', 'exp_samples': [expected(9)]},
        {'expr': '(' + dashboard_query(boards, '延迟 · 成功请求 P95', board='overview') + ') < bool 100',
         'eval_time': '1m', 'exp_samples': [expected(1)]},
        {'expr': dashboard_query(boards, '错误比例 · 5xx 与 4xx 分开', board='trends'),
         'eval_time': '1m', 'exp_samples': [expected(0)]},
        {'expr': '(' + dashboard_query(boards, '成功请求延迟 · 5 分钟窗口', ref='B', board='trends') + ') < bool 100',
         'eval_time': '1m', 'exp_samples': [expected(1)]}]
    cases.append(orphan)

    current_error = copy.deepcopy(http)
    for row in current_error:
        if row['series'].startswith('server_monitor:http_requests:rate1m{') and 'status="500"' in row['series']:
            row['values'] = '1+0x4'
    cases.append(case(current_error, dashboard_query(boards, '错误 · 服务端 5xx', board='overview'), [expected(10)]))

    # A healthy collection source without any observed request remains NoData.
    quiet = case(http[:2], dashboard_query(boards, '流量 · 每秒请求', board='overview'), [])
    quiet['promql_expr_test'] += [
        {'expr': dashboard_query(boards, title, board='overview'), 'eval_time': '1m', 'exp_samples': []}
        for title in ['错误 · 服务端 5xx', '延迟 · 成功请求 P95']]
    cases.append(quiet)

    # The marker's value is a source capture. A new recording evaluation clock
    # cannot make an old capture fresh, even with a currently healthy up gauge.
    expired = copy.deepcopy(http)
    expired[1]['values'] = '0+0x4'
    cases.append(case(expired, dashboard_query(boards, '流量 · 每秒请求', board='overview'), []))
    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--promtool', required=True, type=Path, help='Pinned native Prometheus promtool binary')
    args = parser.parse_args()
    if not args.promtool.is_file():
        parser.error('--promtool must name an existing binary')
    boards = {path.stem: json.loads(path.read_text(encoding='utf-8')) for path in DASHBOARDS.glob('*.json')}
    if not {'overview', 'infrastructure', 'trends'} <= boards.keys():
        raise RuntimeError('All three provisioned Grafana dashboard JSON files are required')
    expressions = [expand(target['expr']) for board in boards.values() for panel in panels(board)
                   for target in panel.get('targets', []) if target.get('expr')]
    if not expressions:
        raise RuntimeError('Grafana dashboard targets are missing')
    cases = build_cases(boards)
    # Parse AND evaluate every actual expression with no input: no observed
    # request/resource source must stay empty, rather than becoming healthy 0.
    syntax_case = {'interval': '15s', 'input_series': [], 'promql_expr_test': [
        {'expr': expression, 'eval_time': '1m', 'exp_samples': []} for expression in expressions]}
    with tempfile.TemporaryDirectory(prefix='monitor-grafana-query-fixtures-') as directory:
        fixture = Path(directory) / 'queries.json'
        fixture.write_text(json.dumps({'rule_files': [], 'evaluation_interval': '15s',
                                       'tests': [*cases, syntax_case]}, ensure_ascii=False), encoding='utf-8')
        subprocess.run([str(args.promtool.resolve()), 'test', 'rules', str(fixture)], check=True, timeout=60)
    print(json.dumps({'result': 'passed', 'dashboardExpressions': len(expressions), 'semanticScenarios': len(cases)}))


if __name__ == '__main__':
    main()
