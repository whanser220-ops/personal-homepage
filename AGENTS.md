# Personal website development workflow

For every new website code or content task in this repository:

1. Start from the latest `origin/main` in a new, task-specific Git worktree. If the current checkout is already the dedicated worktree for this task, reuse it. Do not develop in the shared primary checkout or the cloud deployment checkout at `/opt/personal-homepage`.
2. Keep unrelated worktrees and uncommitted files intact. Implement and validate the task in its worktree, then review the diff and commit only files belonging to that task.
3. Develop on a `codex/` feature branch. Push and maintain one Draft PR targeting main; do not directly push main. Explain the problem, behavior changes, validation and remaining work. After self-review and necessary local checks, mark that PR ready for review and deliver its URL and full SHA.
4. End development delivery at ready-for-review. Official Codex Code Review, independent Jenkins PR CI, owner-authorized merge and the existing Jenkins `personal-homepage-deploy` handle subsequent stages. Do not merge, trigger deployment or wait for a full release unless explicitly requested.
5. Preserve the task worktree for review fixes. After the PR is merged, follow-up maintenance may clean up its branch and worktree after checking additional commits and local/ignored files. Use the managed archive operation for managed worktrees; otherwise use `git worktree remove`. Never remove the primary checkout or another task's active worktree.

## Validation and review

- Run `npm run build` and validate affected behavior. The Dockerfile also runs `node --test tests/home-render*.test.mjs tests/monitor*.test.mjs tests/studyAgentDocs.test.mjs`; reuse those checks rather than assuming a nonexistent `npm test` or lint script.
- UI changes require desktop/narrow layout, navigation, interaction and browser-error checks. APIs, auth, database and SSE changes require success and rejection paths. Preserve resource cleanup, reduced-motion support and scene loading failure behavior.
- Keep database access, tokens and private configuration on the server; never commit credentials or real environment files.
- Use official Codex Code Review with automatic review on each push; request a manual review with `@codex review` on the PR.
- Jenkins `personal-homepage-pr-ci` independently discovers owner-authored, same-repository, non-Draft PRs targeting main. It tests the merged revision in an isolated disposable container and publishes `pr-ci`; that temporary merge is never pushed. Review and CI run independently.
- The trusted CI pipeline and worker are maintained under Study Agent's `deploy/pr-ci/` and pinned by an administrator. PR workers receive no Docker socket, host workspace, production, Jenkins, GitHub App or model credentials.
- The shared custom gate and its `/merge`, `/recheck` and `/review-dismiss` commands are retired. The owner merges through GitHub after checking current review findings, CI, conflicts and target-branch changes. Missing or unfinished results are not acceptance. A development agent still needs explicit authorization for that particular PR to merge or enable auto-merge.
- Preserve main-only image publication, deployment, health checks and rollback. PR CI must never publish images or deploy.

## Code Review Rules

- Read `REVIEW.md` for repository-specific constraints. Report introduced defects with a concrete trigger, current file and line, and call-path or data-flow evidence. Distinguish existing behavior and style advice, and avoid duplicate root causes.
- Prioritize route and article consistency, private monitor authentication, aggregation units and windows, SSE and Three.js cleanup, narrow layouts, reduced motion, and tested-image rollback.
