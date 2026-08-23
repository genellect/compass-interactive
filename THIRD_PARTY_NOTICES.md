# Third-Party Notices

COMPASS Interactive includes or depends on third-party software and may contain
third-party assets. Those materials remain subject to their own licenses,
notices, and brand policies. The COMPASS Interactive source evaluation license
does not relicense them.

This file records direct software dependencies resolved for the
2026-08-23 publication review. `package-lock.json`, NuGet project files, Edge
import specifiers, and the generated SBOM are the complete version inventory of
record. Transitive dependencies retain their own terms even when not listed
individually below.

## JavaScript and TypeScript dependencies

| Package                 | Reviewed version | License           |
| ----------------------- | ---------------: | ----------------- |
| `@aws-sdk/client-s3`    |         3.1083.0 | Apache-2.0        |
| `@supabase/supabase-js` |          2.110.0 | MIT               |
| `pdfjs-dist`            |          6.2.108 | Apache-2.0        |
| `qrcode`                |            1.5.4 | MIT               |
| `react`                 |           19.2.7 | MIT               |
| `react-dom`             |           19.2.7 | MIT               |
| `react-router`          |            8.3.0 | MIT               |
| `@axe-core/playwright`  |           4.12.1 | MPL-2.0           |
| `@playwright/test`      |           1.61.1 | Apache-2.0        |
| `@types/node`           |          24.13.2 | MIT               |
| `@types/qrcode`         |            1.5.6 | MIT               |
| `@types/react`          |          19.2.17 | MIT               |
| `@types/react-dom`      |           19.2.3 | MIT               |
| `@vitejs/plugin-react`  |            6.0.3 | MIT               |
| `jsqr`                  |            1.4.0 | Apache-2.0        |
| `oxlint`                |           1.72.0 | MIT               |
| `prettier`              |            3.9.4 | MIT               |
| `supabase`              |          2.109.1 | MIT               |
| `typescript`            |            6.0.3 | Apache-2.0        |
| `vite`                  |            8.1.3 | MIT               |
| `wrangler`              |          4.110.0 | MIT OR Apache-2.0 |

Supabase Edge Functions also import `@supabase/supabase-js` through versioned
`npm:` or `esm.sh` specifiers. That does not change its MIT license.

## Native dependency

| Package    | Reviewed version | License |
| ---------- | ---------------: | ------- |
| `Velopack` |            1.2.0 | MIT     |

The NuGet package identifies Velopack Ltd, Caelan Sayler, and Kevin Bost as its
authors and identifies the upstream project as
`https://github.com/velopack/velopack`.

## License identifiers

- MIT License: <https://spdx.org/licenses/MIT.html>
- Apache License 2.0: <https://www.apache.org/licenses/LICENSE-2.0>
- Mozilla Public License 2.0: <https://www.mozilla.org/MPL/2.0/>

Distribution of a compiled application must preserve every notice and source
availability obligation required by the exact dependency set used for that
build. A generated SBOM or lockfile is evidence of composition; it does not
replace the applicable license text or notice.

## Assets and brands

The publication status, hashes, provenance, and outstanding rights decisions
for tracked PDFs, images, icons, logos, and other media are recorded in
[`docs/ASSET_PROVENANCE.md`](docs/ASSET_PROVENANCE.md). An item marked pending
or requiring confirmation there is not cleared merely because it appears in
this repository or this notice.

Historical commits contain unmodified or line-ending-only variants of the
starter favicon, icon sprite, React and Vite SVGs, and hero image distributed
with the React template in Vite v8.1.1. They are no longer used by the current
application. The reviewed files match the official Vite template and are
provided under the Vite repository's MIT License:

> MIT License
>
> Copyright (c) 2019-present, VoidZero Inc. and Vite contributors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

The notice above covers copyright permission only. React, Vite, GitHub,
Discord, X, Bluesky, and other names or logos in those historical starter
assets remain subject to their owners' trademark and brand policies. Their
historical presence identifies the upstream template and does not imply
affiliation or endorsement.

References to GitHub, Google, Supabase, Cloudflare, OpenAI, React, Vite, and
other third-party products identify interoperability or dependencies only. No
affiliation, sponsorship, or endorsement is claimed.
