# Personal website development workflow

For every new website code or content task in this repository:

1. Start from the latest `origin/main` in a new, task-specific Git worktree. If the current checkout is already the dedicated worktree for this task, reuse it. Do not develop in the shared primary checkout or the cloud deployment checkout at `/opt/personal-homepage`.
2. Keep unrelated worktrees and uncommitted files intact. Implement and validate the task in its worktree, then review the diff and commit only files belonging to that task.
3. Develop on a `codex/` feature branch. Push and maintain one Draft PR targeting main; do not directly push main. Explain the problem, behavior changes, validation and remaining work. After self-review and necessary local checks, mark that PR ready for review and deliver its URL and full SHA.
4. End development delivery at ready-for-review. Independent PR checks, controlled merge and the existing Jenkins `personal-homepage-deploy` handle subsequent stages. Do not merge, trigger deployment or wait for a full release unless explicitly requested.
5. Preserve the task worktree for review fixes. After the PR is merged, follow-up maintenance may clean up its branch and worktree after checking additional commits and local/ignored files. Use the managed archive operation for managed worktrees; otherwise use `git worktree remove`. Never remove the primary checkout or another task's active worktree.

## Validation and review

- Run `npm run build` and validate affected behavior. The Dockerfile also runs `node --test tests/home-render*.test.mjs tests/monitor*.test.mjs tests/studyAgentDocs.test.mjs`; reuse those checks rather than assuming a nonexistent `npm test` or lint script.
- UI changes require desktop/narrow layout, navigation, interaction and browser-error checks. APIs, auth, database and SSE changes require success and rejection paths. Preserve resource cleanup, reduced-motion support and scene loading failure behavior.
- Keep database access, tokens and private configuration on the server; never commit credentials or real environment files.
- Ready PRs and new commits receive `pr-ci` and `ai-review`; main changes invalidate old combinations. Draft PRs do not run. Review priorities are in `REVIEW.md`.
- The private shared gate is maintained under Study Agent's `deploy/pr-gate/`. PR workers receive no production or GitHub App credentials.
- Once both current checks pass, the repository owner comments `/merge`. The gate revalidates head/main and executes one SHA-bound squash merge. A development agent must not post `/merge` without explicit authorization for that particular PR.
- The owner can use `/recheck`, or `/review-dismiss <full-head-SHA> <finding-ID> <specific reason>` to record a false positive for that exact commit.
- This is a process gate on GitHub Free private repositories; the manual merge button remains available. Do not use it to bypass failed or missing checks.
- Preserve main-only image publication, deployment, health checks and rollback. PR CI must never publish images or deploy.
