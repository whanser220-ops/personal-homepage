# Real HTTP request metrics

The independent, pinned [prometheus-nginxlog-exporter v1.11.0](https://github.com/martin-helmich/prometheus-nginxlog-exporter/releases/tag/v1.11.0) tails one dedicated Nginx log. The ordinary website monitoring APIs and Google sessions do not change.

The log contains exactly `service`, `status`, `request_time`, and `body_bytes_sent`. It contains no address, URL, query string, request header, user agent, cookie, or request body. Service values are fixed to `website`, `whiteboard`, and `study-agent`; unknown values are rejected by Prometheus. The Nginx transaction owns classification and exclusions; `install-monitor-logrotate.py` independently owns the private log permissions and rotation. The exporter only reads the file.

Prometheus scrapes `127.0.0.1:19111/metrics` every 3 seconds as `server-monitor-http`. Only these request metric families enter its TSDB:

| Metric | Request labels | Meaning |
| --- | --- | --- |
| `server_monitor_http_requests_total` | `service,status` | Completed eligible requests observed by the log tailer |
| `server_monitor_http_response_bytes_total` | `service,status` | Response body bytes sent by Nginx |
| `server_monitor_http_request_duration_seconds_bucket` | `service,status,le` | Complete Nginx request-duration histogram |
| `server_monitor_http_request_duration_seconds_sum` | `service,status` | Sum of eligible request durations in seconds |
| `server_monitor_http_request_duration_seconds_count` | `service,status` | Number of eligible duration observations |
| `server_monitor_http_parse_errors_total` | none | Privacy-log parsing failures; must remain zero |

Prometheus also attaches its fixed `job`, `instance`, and `host_id` labels. It removes the upstream exporter's empty method label. Histogram bounds in seconds are `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, +Inf`.

`http-sre.rules.yml` records per-service/status request and byte rates over 1 minute. Its successful-duration buckets include only 2xx and 3xx responses, while 5xx-duration buckets remain separate. Client errors (4xx) retain their own status labels and are not counted as server errors. Aggregated latency must combine buckets before `histogram_quantile`; averaging service quantiles is incorrect.

The final 3-second rule emits `server_monitor_http_recorded_at_seconds`: its value is the actual exporter scrape timestamp, and its raw Prometheus timestamp identifies the complete recording frame. Every dashboard HTTP alias must match that exact raw recording timestamp before aggregation; both source capture and recording age must be under 9 seconds. This prevents old status/service aliases from reappearing through Prometheus lookback after a restart. The HTTP aliases already represent 1-minute/5-minute windows, so history queries sample those atomic frames at the selected 3-second/5-minute/30-minute point step without carrying old values across gaps. There is no null-to-zero fill.

These are measurements from the server's own Nginx ingress. Requests that bypass Nginx are outside this coverage. Observability routes, known health probes, WebSocket upgrades, and streaming responses are excluded by Nginx. Only completed requests can produce a duration; current active requests are not counted yet. `request_time` includes Nginx's entire response duration, not just application execution.

There is no HTTP request history before instrumentation. Low traffic produces sparse observations; zero requests proves no application health. `rate` and `increase` over sampled counters are estimates, not an exact request ledger. The native exporter begins at the current end of an existing file on startup, so restarts reset its counters and requests completed while it is stopped are not replayed. Coverage panels should show exporter `up` and parse errors, and disclose these gaps. This exporter does not emit a process-start timestamp. No 99.9% SLO or external availability is inferred.

The service runs as `monitor-http`, reads the root-owned `www-data` group log, listens only on loopback, and cannot write the log. Its unit caps memory at 96 MiB and CPU at 10% of one core. Log rotation is hourly or at 10 MiB with two retained files; copytruncate and exporter restart behavior are exercised against the actual pinned Linux binary by `tests/verify_http_exporter_native.py`.

Stage `prometheus-nginxlog-exporter_1.11.0_linux_amd64.tar.gz` in `/opt/personal-homepage-prometheus/downloads`. Its upstream SHA-256 is `ab640b73b7e22d1f46197a98c3a06c548d66f9e3fb36b9437011997643569aa6`. `deploy/install-http-metrics.py prepare` checks the privacy log, validates the immutable binary and configuration, records the previous unit/config, and starts only this exporter. `verify` checks its private parser endpoint; `rollback` restores its own unit/config without altering traffic logs; `commit` accepts the transaction. Run `install-monitor-logrotate.py prepare` first; its policy is `/etc/personal-homepage-monitor/traffic.logrotate`, with the existing independent state file. No active Grafana component is required.

Optional node_exporter PSI counters describe host CPU, memory, and I/O waiting or stalled time. They remain unavailable when the kernel does not support pressure accounting; the existing nine required host collectors remain required independently.
