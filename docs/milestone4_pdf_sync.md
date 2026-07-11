# Milestone 4 PDF synchronization

## Architecture

PDF bytes are immutable frontend assets under `public/lecture-assets/` and are
published by Cloudflare Pages with the rest of the Vite build. Supabase does not
store PDF bytes, URLs, titles, or page counts.

The shared asset ID is resolved through two small, source-controlled catalogs:

- `src/pdf/lectureAssets.ts` for the browser
- `supabase/functions/_shared/pdfAssets.ts` for Admin validation

Each catalog maps the same document ID to a static Cloudflare path and page
count. Adding a document therefore requires adding its PDF file and updating
both catalogs in one change.

## Live state

`20260711111834_pdf_sync.sql` adds only `pdf_document_id` to
`lecture_live_state`. The existing columns continue to hold the other display
fields:

- `pdf_document_id`: selected static asset ID, or `null`
- `current_pdf_page`: presenter page, starting at 1
- `display_mode`: normal, presentation, or slideOnly
- `display_version`: increments once per effective display change
- `state_version`: increments with the display version

`admin_update_pdf_display` performs the document, page, mode, and version update
atomically. It is a security-invoker RPC available only to `service_role`.
Closed lectures reject changes, and no-op requests do not increment versions.

The public snapshot RPC remains the single five-second sync request. Its M2
implementation is preserved as a private core function, while the public wrapper
adds `display.pdf_document_id` to the existing snapshot payload. The private core
cannot be executed by public, anon, authenticated, or service_role.

## UI behavior

Admin selects an asset, publishes it, switches pages, and changes display mode
through `update-display-state`. The Edge Function validates the document ID and
page bounds against the static catalog before calling the atomic RPC.

Student and Display screens use `SyncedPdfViewer`, which requests the static URL
directly and renders it with PDF.js. Display always follows the presenter.
Students follow by default, may browse locally without writing to Supabase, and
can resume presenter follow. The next five-second snapshot corrects remote state
without introducing an additional polling request.

## Deployment order

1. Publish the static PDF asset and frontend catalogs from the same commit.
2. Apply `20260711111834_pdf_sync.sql` after the M2 and M3 migrations.
3. Deploy only the M4 `update-display-state` Edge Function.
4. Smoke-test the snapshot and static PDF URL.
5. Publish the frontend from that commit.

Do not run the baseline migration against an existing database.
