# Contributing to COMPASS Interactive

Thank you for helping improve COMPASS Interactive. This repository is
source-available, not open source. Access to the source does not grant
production, commercial, hosting, redistribution, or branding rights beyond
those stated in [`LICENSE`](LICENSE).

## Choose the right channel

- Report suspected vulnerabilities through the private process in
  [`.github/SECURITY.md`](.github/SECURITY.md). Do not disclose vulnerability
  details in an issue, discussion, pull request, screenshot, video, or log.
- Use an issue for a reproducible product defect or a focused enhancement.
- Use a pull request for a bounded change that can be reviewed and tested.

This repository does not provide access to hosted environments, production
data, credentials, paid providers, or private lecture content. Public issue and
pull-request content must be safe to disclose.

## Development boundary

Create a focused branch from the current default branch and use the committed
Node.js version and lockfile:

```bash
npm ci
npm run cloud:check
```

The `/demo` route and the local Supabase stack are the supported verification
surfaces. Do not target a hosted COMPASS Interactive environment, trigger paid
AI operations, publish assets, or deploy infrastructure unless a maintainer has
given explicit authorization for that exact external action.

For a smaller change, run the relevant subset and record every omitted gate:

```bash
npm run security:secrets
npm run typecheck
npm run typecheck:e2e
npm run lint
npm run test:ci:nonlive
npm run build
```

UI changes should include the applicable Playwright demo coverage. Database,
RLS, Edge Function, Worker, or native Presenter changes must follow the gate
mapping in [`docs/GATE_ROUTING.md`](docs/GATE_ROUTING.md).

## Pull-request requirements

A contribution must:

- have one clear purpose and avoid unrelated refactoring;
- preserve authentication, authorization, RLS, lifecycle, cost, privacy, and
  environment boundaries;
- include tests or explain precisely why a named gate was not executed;
- contain no secret, token, PIN, personal data, private lecture material,
  production trace, database dump, or generated credential-bearing artifact;
- identify every reused, generated, or materially AI-assisted work and the
  rights that permit its submission;
- update [`docs/ASSET_PROVENANCE.md`](docs/ASSET_PROVENANCE.md) for changed
  media, documents, icons, fonts, logos, or other visual assets; and
- retain all license, notice, attribution, and source-available markings.

Use the repository pull-request template and record actual results as `PASS`,
`FAIL`, or `not executed` with a reason. Do not represent a local, mocked, or
default-OFF result as hosted or production verification.

## Contributor License Agreement

Every external contributor must read [`CLA.md`](CLA.md) and place this exact
statement in the pull request:

> I have read and agree to the COMPASS Interactive CLA 1.0.

If an employer, institution, client, or another person may control the work,
obtain their authorization before submitting it. A maintainer may request a
separate corporate or signed agreement.

## Review and acceptance

All changes are reviewed for product fit, security, rights, maintainability,
and test evidence. Submission does not guarantee review, acceptance, merge,
publication, support, or release. Accepted contributions remain governed by
the CLA; pre-existing project material remains owned by its existing rights
holder.

Participation is also subject to [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
