#!/usr/bin/env python3
"""Maintain the monitoring include, privacy log and HTTP/2 in our HTTPS vhost."""
from pathlib import Path
import re
import sys

def update_https(source):
    anchor = re.compile(r'(?m)^    server_name warmhanser\.com;\r?\n')
    matches = list(anchor.finditer(source))
    if len(matches) != 1:
        raise ValueError('Cannot identify one warmhanser.com HTTPS vhost')
    before = list(re.finditer(r'(?m)^server\s*\{[^\S\r\n]*\r?\n', source[:matches[0].start()]))
    after = re.search(r'(?m)^\}[^\S\r\n]*(?:\r?\n|$)', source[matches[0].end():])
    if not before or not after:
        raise ValueError('Cannot identify the HTTPS server boundaries')
    start, end = before[-1].start(), matches[0].end() + after.end()
    block = source[start:end]
    listen = re.compile(r'(?m)^(    listen\s+(?:(?:\[[^\]]+\]|[0-9.]+):)?443\s+)([^;\r\n]+);')
    listeners = list(listen.finditer(block))
    if not listeners or any('ssl' not in item.group(2).split() for item in listeners):
        raise ValueError('The target must have SSL listeners on port 443')
    modern = re.search(r'(?m)^\s+http2\s+(on|off)\s*;', block)
    if modern and modern.group(1) == 'off':
        raise ValueError('The target explicitly disables HTTP/2')
    if not modern:
        # The deployed Nginx 1.24 has ngx_http_v2_module and uses the listen
        # option; the standalone http2 directive was added in Nginx 1.25.1.
        block = listen.sub(lambda item: item.group(0) if 'http2' in item.group(2).split()
                           else item.group(1) + item.group(2).rstrip() + ' http2;', block)
    directives = (
        '    include /etc/nginx/snippets/server-monitor.conf;\n',
        '    access_log /var/log/personal-homepage-monitor/traffic.jsonl monitor_http if=$monitor_http_record;\n',
    )
    for directive in directives:
        if directive.strip() not in block:
            block = anchor.sub(lambda match: match.group(0) + directive, block, count=1)
    return source[:start] + block + source[end:]


if __name__ == '__main__':
    target = Path(sys.argv[1] if len(sys.argv) > 1 else '/etc/nginx/conf.d/study-agent-https.conf')
    try:
        result = update_https(target.read_text(encoding='utf-8'))
    except ValueError as error:
        raise SystemExit(str(error))
    target.write_text(result, encoding='utf-8')
