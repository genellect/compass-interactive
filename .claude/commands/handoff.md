---
description: Check the work against the completion criteria in docs/CLOUD_DEVELOPMENT.md before handing off or opening a Draft PR
---

Verify this task against the completion criteria (完了基準) in `docs/CLOUD_DEVELOPMENT.md`. A cloud task may only be handed off once all seven hold.

Work through them in order and report each with concrete evidence.

1. **最新 `origin/main` から専用 branch を使用している** — show the branch name and its merge base against `origin/main`. Committing to `main` is a violation, not a note.
2. **変更範囲が明確で、Hosted / Production への不要な影響がない** — summarize `git diff --stat` and state what the change does and does not touch. Call out any migration, Edge Function, Cloudflare, or R2 surface explicitly.
3. **`npm run cloud:check` が完了している** — paste the outcome. If it was not run, say so; do not infer it from a green sub-gate.
4. **UI 変更では該当 Demo E2E、database 変更では local Supabase gate が完了している** — first state whether the change touches `src/` or `supabase/`. If it does and the gate did not run, this criterion **fails**; it does not become optional because the environment lacked a browser or a Docker daemon.
5. **secret scan と `git diff` を確認している** — `npm run security:secrets` result, plus confirmation that the diff introduces no `.env*`, credential, lecture code, personal data, database dump, or `VITE_`-prefixed secret.
6. **commit と push が完了し、Draft PR で review 可能である** — the pushed branch and the Draft PR URL.
7. **実施していない Hosted / Device / Human / Production 確認を PASS と表現していない** — list every gate that did not run and why.

## Reporting rules

Produce two explicit lists and do not blur them:

- **Executed and passed** — only gates you actually ran and observed succeed, in this session, on this code.
- **Not executed** — everything else, each with its reason: out of scope, environment cannot run it, or explicitly forbidden by `AGENTS.md`.

A gate that was skipped, blocked, inferred, assumed from a previous run, or unavailable in this environment belongs in **Not executed**. Never move it to the passed list, never write "should pass", and never leave it out of both lists. If a required gate could not run, say plainly that the task is not ready for handoff and name what a reviewer must run.

$ARGUMENTS
