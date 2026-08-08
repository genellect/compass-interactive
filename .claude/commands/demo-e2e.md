---
description: Run the Playwright demo browser gate against /demo
---

Run the demo browser gate:

```bash
npm run test:e2e:demo
```

This is the required gate for any change under `src/`. The demo path must not reach Supabase, OpenAI, Cloudflare R2, or any other paid or Production service — if a demo test starts needing a network credential, that is the finding, not an obstacle to route around.

Before running, confirm the browsers are installed:

```bash
npx playwright install chromium webkit
```

If the environment cannot download browsers — a sandbox with no egress, a proxy that blocks the CDN — **stop and report the gate as not executed**. Do not substitute a static test and describe it as browser coverage.

Targeted variants, when the change is scoped to one feature:

- `npm run test:e2e:phase7-26` / `:flag-off` — browser PDF publication
- `npm run test:e2e:phase7-27` / `:flag-off` — Journal Club preset
- `npm run test:e2e:demo:triple` — three repeats, for suspected flake

Report the project matrix that actually ran (Chromium / WebKit / mobile Chromium) and the pass or fail per project. On failure, include the Playwright output and say whether it reproduces on a repeat run.

$ARGUMENTS
