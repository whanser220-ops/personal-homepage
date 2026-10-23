#!/usr/bin/env python3
"""Insert only our include into the independently maintained HTTPS vhost."""
from pathlib import Path
import re
import sys

target = Path(sys.argv[1] if len(sys.argv) > 1 else '/etc/nginx/conf.d/study-agent-https.conf')
include = '    include /etc/nginx/snippets/server-monitor.conf;\n'
source = target.read_text()
if include.strip() not in source:
    anchor = re.compile(r'(?m)^    server_name warmhanser\.com;\r?\n')
    if len(anchor.findall(source)) != 1 or not re.search(r'listen\s+443\s+ssl', source):
        raise SystemExit('Cannot identify the warmhanser.com HTTPS vhost')
    target.write_text(anchor.sub(lambda match: match.group(0) + include, source, count=1))
