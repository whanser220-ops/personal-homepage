# Private Grafana service monitor

The primary `/server-monitor` page is a website navigation/login shell around
three native, provisioned Grafana dashboards. `overview` refreshes instant
statistics every 3 seconds; `trends` and `infrastructure` refresh every 30
seconds. Node sampling remains 3 seconds, other probes remain 15 seconds.

Grafana OSS **13.2.4** runs independently as `personal-homepage-grafana.service`,
user `sre-grafana`, on **127.0.0.1:19110**. The official standalone archive is
`grafana_13.2.4_38252365904_linux_amd64.tar.gz`, SHA256
`c48765988fd88572607e4ea670251af8a8e64ab3e360d0f3cf67a6f3587b92ab`.
Source: [official pinned download page](https://grafana.com/grafana/download/13.2.4?edition=oss&platform=linux).
Stage it in `/opt/personal-homepage-grafana/downloads/`; the installer does not
download or execute an unverified artifact.

## Authentication and data

Every public `/server-monitor/grafana/` request passes Nginx `auth_request` to
the existing Next.js Google database session. Nginx replaces identity headers
with the verified owner email and the fixed `Viewer` role. Grafana trusts only
IPv4 loopback. Basic auth, anonymous access, signups, initial admin creation,
login tokens, external snapshots and alert execution are disabled. Nginx clears
Grafana cookies and authorization upstream, so a separate Grafana session
cannot survive a website logout. Anonymous APIs return 401; HTML documents
return to `/server-monitor` for the existing Google login flow.

Grafana metadata/SQLite persists under `/var/lib/personal-homepage-grafana`.
Configuration, secrets and provisioned dashboards live under
`/etc/personal-homepage-grafana`. The website container gets no new privileges.

Datasource `monitor-prometheus` reads only the local Prometheus at
127.0.0.1:19090. `monitor-legacy-history` uses a separate PostgreSQL login with
SELECT access to the numeric, time-limited resource-history view. It cannot
read monitor sessions, OAuth transactions, sample JSON, or write application
data. Its strict pre-cutover view preserves the older resource history while
Prometheus supplies the newer segment. Real HTTP request history starts when
the new privacy log starts; absent earlier traffic is not filled with zero.

## Request metrics and retention

Nginx writes only four JSON fields to the private metric log:
`service`, `status`, `request_time`, `body_bytes_sent`. Labels are limited to
website, whiteboard and study-agent. The log excludes monitor requests, health
endpoints, WebSocket upgrades and event streams. It contains no URI, IP,
query, cookie, authorization or user-agent fields. Static locations that already
disable access logs remain excluded.

`personal-homepage-http-metrics.service` reads that file on 127.0.0.1:19111.
The log is root:www-data 0640 inside a 0750 directory. A dedicated five-minute
timer checks hourly/10MiB rotation, retaining two rotations; file size can grow
between checks. Rotation uses its own state file and is not also registered in
the global daily logrotate configuration.

## Deployment and rollback

The website deployment prepares the restricted history role, private Grafana,
HTTP exporter, and shadow Prometheus before the candidate compiled Next.js
auth/monitor gate. Only then does it switch the production website/Prometheus
and reload the complete HTTP and HTTPS Nginx configuration. Release verification
checks forged identity headers, anonymous APIs, internal auth isolation,
Viewer permissions, all three provisioned boards, and actual datasource queries.

`deploy/install-grafana.py shadow` prepares/validates only the private service
and commits that baseline; it never reloads Nginx. `prepare`, `verify`,
`rollback`, and `commit` support the enclosing website transaction. An update
takes a bounded SQLite online backup, including committed WAL pages. Failure
restores Nginx first, then Prometheus/exporters/Grafana and its prior metadata,
then the history role/credentials and the prior website image. Existing resource
samples, OAuth sessions, cutoff, and the legacy collector queue are preserved.

Check service state without printing environment secrets:

```sh
systemctl status personal-homepage-grafana personal-homepage-http-metrics personal-homepage-monitor-logrotate.timer
sudo python3 deploy/install-grafana.py verify
sudo python3 deploy/install-grafana-history.py verify
sudo python3 deploy/verify-grafana.py
```

Native Grafana and Prometheus keep their independent state and versioned
binaries across website image deployments. No Grafana admin account is exposed
on the public proxy; dashboard definitions are reviewed in Git.
