# Personal website development workflow

For every new website code or content task in this repository:

1. Start from the latest `origin/main` in a new, task-specific Git worktree. If the current checkout is already the dedicated worktree for this task, reuse it. Do not develop in the shared primary checkout or the cloud deployment checkout at `/opt/personal-homepage`.
2. Keep unrelated worktrees and uncommitted files intact. Implement and validate the task in its worktree, then review the diff and commit only files belonging to that task.
3. Push the commit through the repository's current branch policy so the intended commit reaches `origin/main`. Check whether the existing Jenkins `personal-homepage-deploy` CI/CD pipeline started for that commit; trigger the existing job once if the webhook did not start it. Do not trigger a duplicate build.
4. Confirm Jenkins checked out the intended commit and completed successfully. Verify the deployed version and the relevant public pages or resources, rather than treating a push or build alone as proof of release.
5. After deployment and public verification, remove the task worktree. Use the managed worktree archive operation when it is a Codex-managed worktree; otherwise use `git worktree remove`. Never remove the primary checkout or another task's active worktree. Preserve a worktree that is still needed to diagnose or finish a failed deployment.
