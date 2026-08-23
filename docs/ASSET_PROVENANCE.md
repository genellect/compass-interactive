# Repository Asset and Rights Ledger

Last reviewed: 2026-08-23
Scope: Git-tracked media, document, icon, and brand assets at commit
`eb12b48c3a59cd311e93e47c41cdad1cd3842ffb`

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

| Path                                             | SHA-256                                                            | Repository provenance                                                                                 | Content and current use                                                                                                                                            | Publication status                                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/favicon.svg`                             | `61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66` | Initial commit `9d17b4e` by Yuto Matsui                                                               | Vite logo artwork; referenced by `index.html` as the site favicon                                                                                                  | **Third-party policy required.** Replace with an owner-created COMPASS Interactive favicon before publication, or retain verified Vite license and trademark-policy evidence.                                                       |
| `public/icons.svg`                               | `b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a` | Initial commit `9d17b4e` by Yuto Matsui                                                               | Composite sprite containing Bluesky, Discord, GitHub, X, documentation, and social symbols; no current source reference found                                      | **Rights confirmation required.** Remove if unused, or document the source, applicable licenses, and each brand's usage policy.                                                                                                     |
| `src/assets/react.svg`                           | `35ef61ed53b323ae94a16a8ec659b3d0af3880698791133f23b084085ab1c2e5` | Initial commit `9d17b4e` by Yuto Matsui                                                               | React logo; no current source reference found                                                                                                                      | **Third-party policy required.** Remove if unused, or document source, license, and brand policy.                                                                                                                                   |
| `src/assets/vite.svg`                            | `5be21acd42eb7b896e517f4e0f0f11eb5c5d9e54fbbcebe9453f033008fcca6f` | Initial commit `9d17b4e` by Yuto Matsui                                                               | Vite logo; no current source reference found                                                                                                                       | **Third-party policy required.** Remove if unused, or document source, license, and brand policy.                                                                                                                                   |
| `src/assets/hero.png`                            | `881ffbcaafc212e49addad08846a5b82761355fa20624253af3477ba33262c5c` | Initial commit `9d17b4e` by Yuto Matsui                                                               | Abstract layered graphic; no current source reference found and no embedded provenance record                                                                      | **Rights confirmation required.** Record original source/creator and generation or license terms, or remove if unused.                                                                                                              |
| `public/lecture-assets/m4-sample-v1.pdf`         | `c2b33586ab59ff1825ee0dc07f0a6151124955746b956905d40c27619e84d8cb` | Commit `da8d13e` by Yuto Matsui; ReportLab metadata; title `COMPASS Interactive Milestone 4 PDF Sync` | Three-page synthetic COMPASS Interactive PDF Sync sample; no embedded files, JavaScript, forms, or third-party imagery observed                                    | **Conditionally cleared.** Owner attestation is required because PDF metadata identifies the author and creator only as `anonymous`.                                                                                                |
| `public/lecture-assets/why-learn-english-v1.pdf` | `177b642ae3368d0fa3953e2558a744433af445c7d6c26cf8491ea978050cb683` | Commit `e3c29a9` by Yuto Matsui; visible author attribution to Yuto Matsui                            | Fifteen-page English-learning presentation with composite illustrations and product screenshots; no embedded files, JavaScript, forms, or detailed source metadata | **Rights confirmation required.** Retain evidence for the text, screenshots, illustrations, stock or generated imagery, fonts, and any depicted third-party material, or remove/replace the unresolved material before publication. |

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

| Asset or group                            | Decision | Evidence location | Owner       | Date    |
| ----------------------------------------- | -------- | ----------------- | ----------- | ------- |
| COMPASS-created marks and visual identity | Pending  | Pending           | Yuto Matsui | Pending |
| Vite and React logo assets                | Pending  | Pending           | Yuto Matsui | Pending |
| Social-platform icon sprite               | Pending  | Pending           | Yuto Matsui | Pending |
| `hero.png`                                | Pending  | Pending           | Yuto Matsui | Pending |
| `m4-sample-v1.pdf`                        | Pending  | Pending           | Yuto Matsui | Pending |
| `why-learn-english-v1.pdf`                | Pending  | Pending           | Yuto Matsui | Pending |

Any unresolved asset is excluded from publication clearance even when the
source code, security scan, and repository history otherwise pass.
