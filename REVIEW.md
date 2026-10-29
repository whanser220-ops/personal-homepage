# Personal homepage review priorities

Start with the number of confirmed findings; explicitly say when there are none. Report actual defects with current file/line, trigger and evidence. Do not infer bugs from names, block on style, blame a PR for old behavior, or repeat the same root cause.

- Next.js routes, article indexes and asset URLs must agree. Published text and project documentation must describe actual current behavior.
- Private monitor and ingestion endpoints must preserve authentication, input limits, origin handling and failure responses. Server credentials and database configuration must never reach client bundles or logs.
- SSE subscriptions, event listeners, timers and Three.js resources must be cleaned up. Loading failure, first-frame fallback, narrow layouts and reduced-motion behavior must remain usable.
- Monitor aggregation and query changes must preserve units, time windows, access filtering and empty/error behavior; use the existing monitor fixtures as evidence.
- Deployment must use the tested image and manifest, retain previous-image rollback and validate health. PR CI must not receive publication or deployment credentials.
- Shared PR-gate integration must not let outdated checks, untrusted findings or unauthorized comments authorize a merge.
