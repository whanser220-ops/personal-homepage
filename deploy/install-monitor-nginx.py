#!/usr/bin/env python3
"""Insert the monitor include and private metric log into the HTTPS vhost."""
from pathlib import Path
import re
import sys

target = Path(sys.argv[1] if len(sys.argv) > 1 else '/etc/nginx/conf.d/study-agent-https.conf')
include = '    include /etc/nginx/snippets/server-monitor.conf;\n'
metric_log = '    access_log /var/log/personal-homepage-monitor/traffic.jsonl monitor_http if=$monitor_http_record;\n'
source = target.read_text()
for directive in (include, metric_log):
    if directive.strip() in source:
        continue
    anchor = re.compile(r'(?m)^    server_name warmhanser\.com;\r?\n')
    if len(anchor.findall(source)) != 1 or not re.search(r'listen\s+443\s+ssl', source):
        raise SystemExit('Cannot identify the warmhanser.com HTTPS vhost')
    source = anchor.sub(lambda match: match.group(0) + directive, source, count=1)
target.write_text(source)
