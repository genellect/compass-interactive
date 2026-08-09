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

GitHub Education is active. Main ruleset `20600565` now requires a Pull Request,
conversation resolution and these five CI contexts, and rejects force-push and
branch deletion:

- `Quality and non-live regression`;
- `Demo browser E2E`;
- `Local Supabase, pgTAP and live browser E2E`;
- `Presenter Bridge Windows x64 build and tests`;
- `Presenter Bridge Windows x86 build and tests`.

The ruleset intentionally keeps `strict_required_status_checks_policy=false`.
A later `main` update therefore does not force every open PR to update its base
and repeat the complete browser/database matrix, while the five checks remain
mandatory for the actual candidate head. High-risk PRs should still synchronize
with current `main` once near the final head when practical.

Required approving reviews intentionally remain zero to avoid deadlocking the
solo owner. For a manual Copilot review, open the PR, request Copilot from the
Reviewers control, address or explicitly resolve each actionable conversation,
then rerun and verify the exact-head required checks. Copilot is an advisory
external review, not a human approval and not a substitute for any required
check, Hosted/Device/Human evidence or owner Production decision. Re-audit the
live ruleset before a high-risk merge. No administrator bypass is currently
configured; any incident-time ruleset change requires an explicit, dated
decision and must not become the normal integration path.

## Cloudflare build routing

`compass-interactive` is a Cloudflare Pages application. On 2026-08-09 the
misconfigured Workers Builds Git connection was disconnected without deleting
or replacing the existing Worker or Pages deployment. It pointed to the
pre-transfer repository name and attempted `wrangler pages deploy` with a broad
Worker token that lacked Pages authority. Expanding that token or allowing a PR
build to target Production is prohibited as a shortcut.

Until a dedicated least-privilege deployment workflow is separately designed and
approved, there is no automatic Cloudflare deployment or external Cloudflare PR
check. GitHub exact-head CI is the source-landing gate. A Hosted release uses an
explicitly approved Direct Upload from the exact merged main SHA:

```bash
npx wrangler pages deploy dist --project-name compass-interactive --branch main
```

Plain `wrangler deploy` is a Worker deployment command and is not valid for this
Pages project. The operator must record the merged SHA, previous immutable Pages
deployment ID, new deployment ID and rollback target, and must prove the intended
production Vite flags before upload. A future automatic preview/Production path
requires a canonical `genellect/compass-interactive` connection, branch-isolated
preview command, dedicated least-privilege Pages credential, protected
environment and exact-SHA canary. It must not reuse or privilege-expand the
disconnected broad Worker build token.

## Gate decision

The reproducibility portion of C0 is PASS when `cloud:doctor`, `cloud:check`, the
relevant environment contract and exact-head CI pass on a dedicated branch.
The main-protection enforcement subgate is active through ruleset `20600565`.
Phase 7.31A still remains incomplete until the remaining supply-chain controls,
protected deployment environments and negative tests are recorded. This does
not authorize making the private repository public.
