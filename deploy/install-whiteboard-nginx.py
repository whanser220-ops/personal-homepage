#!/usr/bin/env python3
"""Add our include to the existing TLS vhost while preserving Study Agent."""
from pathlib import Path
import re
import sys

target = Path(sys.argv[1] if len(sys.argv) > 1 else "/etc/nginx/conf.d/study-agent-https.conf")
include = "    include /etc/nginx/snippets/learning-whiteboard.conf;\n"
source = target.read_text()
if include.strip() in source:
    sys.exit(0)
# This known vhost is managed independently; fail instead of guessing a server.
anchor = re.compile(r"(?m)^    server_name warmhanser\.com;\r?\n")
if len(anchor.findall(source)) != 1 or not re.search(r"listen\s+443\s+ssl", source):
    raise SystemExit(f"Cannot identify the warmhanser.com TLS server in {target}")
updated = anchor.sub(lambda match: match.group(0) + include, source, count=1)
backup = target.with_suffix(target.suffix + ".before-whiteboard")
if not backup.exists():
    backup.write_text(source)
target.write_text(updated)
