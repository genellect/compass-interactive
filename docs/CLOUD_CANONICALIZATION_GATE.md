# Cloud Canonicalization Gate

Status: Operationally verified
Scope: GitHub canonical source, cloud-first task admission, recovery imports and handoff boundaries
Last verified: 2026-08-09

## Outcome

`https://github.com/genellect/compass-interactive` is the only source repository
that may define new work. A developer machine can hold diagnostics, ignored
credentials or a recovery copy, but an ahead-only local branch is not a release
base. This prevents one PC, one shell profile or one unpushed commit from
becoming an undocumented production dependency.

The gate is intentionally independent from product deployment. Passing it says
that a change has a reproducible and reviewable GitHub base. It does not approve
Hosted Supabase, R2, Cloudflare, OpenAI, Windows COM, a device, a human workflow
or Production.

## C0 admission checklist

Every implementation task records all of the following before edits:

1. canonical repository owner/name;
2. exact fetched `origin/main` SHA;
3. latest completed CI result for that exact SHA;
4. dedicated branch name and isolated Codespace, Codex Cloud task or worktree;
5. expected change surfaces and their routes in `GATE_ROUTING.md`;
6. external-effect level and explicit authorization, if any;
7. rollback boundary before the first Hosted mutation.

If `main` advances, the branch is reconciled with the new canonical SHA and the
affected gates rerun. A previous green run is evidence for its own SHA only.

`npm run cloud:doctor` checks the canonical origin, lockfile identity, minimum
Node contract, required repository policy files and locked local binaries. It
uses no Docker, Hosted service or paid API. `npm run cloud:check` starts with
this doctor. Docker-based Supabase remains a separate Dev Container/Codespaces
handoff, and PowerPoint remains a Windows Device Gate.

## Recovery import contract

An unpushed local change is handled as evidence, not history to merge blindly.

1. Create a fresh clone of the canonical repository.
2. Create a branch from the currently recorded `origin/main` SHA.
3. Inventory the recovery commit, its parent and every path changed.
4. Reapply logical slices in the new branch and review shared files against the
   current implementation. Do not restore an obsolete README, lockfile, CI
   workflow, generated database type or deployment document.
5. Regenerate derived artifacts from the current schema/toolchain.
6. Record source commit provenance without retaining personal or secret
   metadata that is not needed by the product.
7. Run the present-day gates; an old Local Gate cannot be transferred.

Phase 7.29 uses this contract to rescue local source commit `65b56d55` onto
canonical baseline `64238101e123004aa388b4a0d7ba661e03a2ebb7`. CI run
`31262545804` completed successfully for that exact baseline before the rescue
branch was rebased. The new commits use the configured GitHub `noreply`
identity. The former local branch remains only recovery evidence.

## Agent and repository isolation

- One write-capable agent per branch/worktree.
- Parallel agents are read-only reviewers unless they have their own branch.
- The primary agent owns shared source edits, migrations, commits, PR
  integration and deployment sequencing.
- COMPASS and COMPASS Interactive remain separate repositories and cloud
  workspaces. Reusable source or Google configuration is inventoried first;
  secrets, OAuth clients, service accounts, data and deployment state are never
  copied implicitly.
- Development credentials are repository-scoped and least-privilege. Production
  secrets are not copied from a PC into Codex Cloud or a pull request.

## Pull request and merge contract

The PR records its base SHA, execution environment, actual gate results,
default-OFF behavior, rollback and any external asset reuse. Exact-head CI must
be green before merge. Direct commits to `main` and force-push/delete of the
release branch are prohibited by repository policy.

As of 2026-08-08 this private user-owned repository cannot enforce branch
protection through GitHub without a GitHub Pro plan. The repository remains
private, and PR-only integration is therefore a procedural control. Technical
enforcement is a separate governance subgate: enable required checks,
force-push/delete protection and PR review after the approved GitHub Education
benefits become active. This limitation must not be reported as enforced
protection.

## Cloudflare build routing

`compass-interactive` is a Cloudflare Pages application even though the current
Git integration is surfaced through Workers Builds. Keep the two deploy commands
environment-specific:

- production: `npx wrangler pages deploy dist --project-name compass-interactive --branch main`;
- non-production: `npx wrangler pages deploy dist --project-name compass-interactive --branch "$WORKERS_CI_BRANCH"`.

Workers Builds injects `WORKERS_CI_BRANCH` from the push event. A pull request
must therefore create a Pages preview for its own branch and must never pass
`--branch main`. Plain `wrangler deploy` is a Worker deployment command and is
not valid for this Pages project. After changing either dashboard command,
trigger a new exact-SHA build and verify the command in that build's immutable
settings; an old retry can retain the superseded command. A repository transfer
or Git account rename also requires the Cloudflare Git connection to be
reauthenticated against the canonical `genellect/compass-interactive` repository
before the integration is treated as durable.

## Gate decision

The reproducibility portion of C0 is PASS when `cloud:doctor`, `cloud:check`, the
relevant environment contract and exact-head CI pass on a dedicated branch.
The branch-protection enforcement subgate remains HOLD until the plan capability
is available through GitHub Education. That HOLD does not authorize bypassing PR review and does not
require making the private repository public.
