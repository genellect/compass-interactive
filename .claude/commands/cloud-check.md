---
description: Run the non-live verification gate (secret scan, three typechecks, lint, non-live suite, production-equivalent build)
---

Run the repository's standard non-live gate:

```bash
npm run cloud:check
```

This expands to `security:secrets`, `typecheck`, `typecheck:phase3`, `typecheck:e2e`, `lint`, `test:ci:nonlive`, and `build`. It connects to no paid API and no hosted service. Expect roughly 35-45 seconds from a warm `node_modules`.

If it fails:

- Report the failing sub-gate by name and paste the actual failure output. Do not summarize a failure as "some tests failed".
- Fix the cause, then re-run the **whole** `cloud:check`, not just the sub-gate that failed.
- If `node_modules` is missing or stale, run `npm ci` first. Never work around a failure with a global install.

When it passes, state which gate ran and that everything else — Demo E2E, local Supabase, Hosted, Device, Human, Production — was **not executed**. `cloud:check` alone does not clear a UI change or a database change.

$ARGUMENTS
