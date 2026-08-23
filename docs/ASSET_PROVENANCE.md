# Repository Asset and Rights Ledger

Last reviewed: 2026-08-23
Scope: Git-tracked media, document, icon, and brand assets in the Phase 7.31B
publication-preparation tree, reviewed against baseline
`eb12b48c3a59cd311e93e47c41cdad1cd3842ffb`. The final publication SHA must be
recorded after the branch is frozen.

This ledger supports a future source-publication decision. It is evidence, not
a legal opinion. A Git author or commit proves repository provenance only; it
does not by itself prove copyright ownership or third-party redistribution
rights.

## Status definitions

- **Conditionally cleared**: repository evidence supports publication, but the
  owner must record the final rights attestation before visibility changes.
- **Rights confirmation required**: provenance or embedded-material rights are
  incomplete. The file must be removed from public refs or supported by a
  retained rights record before publication.
- **Third-party policy required**: a third-party license, notice, or brand policy
  applies. The project license does not relicense the asset.

## Tracked asset inventory

| Path                                             | SHA-256                                                            | Repository provenance                                                                                 | Content and current use                                                                                                                                                 | Publication status                                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/favicon.svg`                             | `0fa4a5cf0c59d3fc64977feecb969dd785a8c83d0a2e2f7162fc6cb760ae5943` | New Phase 7.31B repository-native replacement                                                         | Simple geometric COMPASS `C` mark made only from SVG primitives; referenced by `index.html`; no copied artwork or external font                                         | **Cleared.** Created specifically for this repository under the owner's approved publication-preparation work; no third-party material identified.                                                                                  |
| `public/lecture-assets/m4-sample-v1.pdf`         | `c2b33586ab59ff1825ee0dc07f0a6151124955746b956905d40c27619e84d8cb` | Commit `da8d13e` by Yuto Matsui; ReportLab metadata; title `COMPASS Interactive Milestone 4 PDF Sync` | Three-page synthetic COMPASS Interactive PDF Sync sample with no images, annotations, embedded files, JavaScript, or forms                                              | **Cleared.** Project-authored synthetic test material with no third-party imagery or active content identified.                                                                                                                     |
| `public/lecture-assets/why-learn-english-v1.pdf` | `177b642ae3368d0fa3953e2558a744433af445c7d6c26cf8491ea978050cb683` | Commit `e3c29a9` by Yuto Matsui; visible author attribution to Yuto Matsui                            | Fifteen-page English-learning presentation with thirteen embedded images and product screenshots; no annotations, embedded files, JavaScript, forms, or extracted email | **Cleared by owner attestation.** The owner confirmed sufficient rights for public redistribution and future commercial SaaS use of the text, images, screenshots, and fonts. Supporting source records remain private.          |

## Removed from the current tree but retained in Git history

The following files had no reference in the current application or tests and
were removed from the Phase 7.31B current tree. Directly making this repository
public would still expose the historical blobs reachable from the initial
commit, so current-tree deletion is not publication clearance for those blobs.

| Historical path               | Historical SHA-256                                                 | Current-tree action | Remaining publication decision                                                                        |
| ----------------------------- | ------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------- |
| Original `public/favicon.svg` | `61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66` | Replaced            | **Cleared:** exact Vite v8.1.1 React-template asset; MIT notice retained in `THIRD_PARTY_NOTICES.md`. |
| `public/icons.svg`            | `b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a` | Removed             | **Cleared:** exact Vite v8.1.1 React-template asset; third-party marks remain acknowledged.           |
| `src/assets/react.svg`        | `35ef61ed53b323ae94a16a8ec659b3d0af3880698791133f23b084085ab1c2e5` | Removed             | **Cleared:** exact Vite v8.1.1 React-template asset; third-party marks remain acknowledged.           |
| `src/assets/vite.svg`         | `5be21acd42eb7b896e517f4e0f0f11eb5c5d9e54fbbcebe9453f033008fcca6f` | Removed             | **Cleared:** Vite v8.1.1 React-template asset differing at most by line endings; MIT notice retained. |
| `src/assets/hero.png`         | `881ffbcaafc212e49addad08846a5b82761355fa20624253af3477ba33262c5c` | Removed             | **Cleared:** exact Vite v8.1.1 React-template asset; MIT notice retained in `THIRD_PARTY_NOTICES.md`. |

The comparison used the official Vite v8.1.1 tag (`4ae9e14f2c4db0706b2e9d815656e050accbd2bf`).
No history rewrite is necessary for these upstream assets, and none is
authorized or performed by this remediation.

No Git-tracked audio, video, font, PowerPoint, Word, or other Office files were
found in the reviewed tree. Test screenshots, videos, Playwright traces, logs,
and SBOMs stored as GitHub Actions artifacts are outside this file inventory and
remain subject to the separate RED/accepted-evidence publication review.

## Software dependencies

Package managers and lock files are the dependency inventory of record:

- npm dependencies: `package.json` and `package-lock.json`;
- GitHub Actions: immutable references in `.github/workflows/`;
- .NET/NuGet dependencies: the tracked project and lock files under
  `presenter-bridge/`; and
- Supabase Edge imports: tracked import specifiers under `supabase/functions/`.

Each dependency remains under its own license. LICENSE does not relicense a
dependency, service-provider mark, or copied brand asset. Generated SBOMs are
supporting evidence and do not replace license or provenance review.

## Owner attestation required before public visibility

For every asset retained in public refs, the owner must record:

1. creator and date, or the exact third-party source;
2. license, purchase, employment, assignment, or generation terms supporting
   public redistribution and future commercial SaaS use;
3. required attribution, notice, or trademark-policy conditions;
4. confirmation that the asset contains no private lecture content, personal
   data, credential, authenticated browser state, or confidential material; and
5. the decision to retain, replace, or remove the asset, with evidence location
   and review date.

| Asset or group                         | Decision                     | Evidence location                    | Owner       | Date       |
| -------------------------------------- | ---------------------------- | ------------------------------------ | ----------- | ---------- |
| New COMPASS geometric favicon          | Retain; cleared              | This ledger and `public/favicon.svg` | Yuto Matsui | 2026-08-23 |
| Historical Vite and React logo assets  | Removed; MIT notice retained | `THIRD_PARTY_NOTICES.md`             | Yuto Matsui | 2026-08-23 |
| Historical social-platform icon sprite | Removed; MIT/marks recorded  | `THIRD_PARTY_NOTICES.md`             | Yuto Matsui | 2026-08-23 |
| Historical `hero.png`                  | Removed; MIT notice retained | `THIRD_PARTY_NOTICES.md`             | Yuto Matsui | 2026-08-23 |
| `m4-sample-v1.pdf`                     | Retain; cleared              | This ledger                          | Yuto Matsui | 2026-08-23 |
| `why-learn-english-v1.pdf`             | Retain; cleared              | Owner attestation; private records   | Yuto Matsui | 2026-08-23 |

On 2026-08-23, the owner attested that they hold or control sufficient rights
to publicly redistribute and use in a future commercial SaaS offering all
text, images, screenshots, and fonts retained in
`public/lecture-assets/why-learn-english-v1.pdf`. The supporting acquisition,
creation, or license records are intentionally retained outside the public
repository.

## Owner-accepted privacy residual

On 2026-08-23, the owner explicitly accepted publication of the personal email
references already tracked in the repository. This ledger does not repeat the
address. That acceptance is limited to the address itself: it does not permit a
credential, authenticated session, private lecture content, production trace,
or any other RED publication item.

Any future unresolved asset is excluded from publication clearance even when
the source code, security scan, and repository history otherwise pass.
