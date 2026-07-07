# COMPASS Interactive Project Guide

## Current Product Direction

COMPASS Interactive is now being developed as a short-term **Journal Club / Lab Seminar DX MVP** for a research-lab seminar setting.

The current MVP target is not the original 200-person pharmacy English lecture deployment. The immediate target is a 20-person lab seminar where participants can anonymously comment, like, answer polls, view poll results, and share a Display screen that can later show PDF slides and live English transcripts.

The original pharmacy English / larger COMPASS lecture direction remains a future expansion path, but the active development plan should prioritize the lab seminar MVP.

## Current Implementation Baseline

The project currently includes:

- Vite + React + TypeScript frontend
- React Router routes:
  - `/join`
  - `/lecture`
  - `/admin`
  - `/display`
- Supabase client integration
- anonymous participant identity in localStorage
- lecture code join through `join_lecture_by_code`
- visible comments fetch / insert
- comments Realtime INSERT subscription
- comment likes fetch / insert
- comment likes Realtime INSERT subscription
- open polls / poll_options fetch
- poll_responses INSERT
- poll results RPC
- minimal Admin PIN gate through Supabase Edge Function
- Display MVP with dark navy / black presentation layout
- AI transcript placeholder
- local PDF viewer for Display slides
- manual SQL and seed SQL workflow

Important current limitations:

- poll responses Realtime is not implemented
- PDF rendering is not implemented
- OpenAI live transcription is not implemented
- Admin dashboard database mutations are not implemented
- Admin PIN gate is an access gate for the UI, not a database authorization model

## Core Principles

- Keep the frontend free of secrets.
- Do not use `VITE_ADMIN_PIN`.
- Do not use `VITE_OPENAI_API_KEY`.
- Do not put `OPENAI_API_KEY`, service role keys, database passwords, or admin secrets in React code.
- Keep participant data anonymous.
- Do not collect names, student IDs, university email addresses, grades, or other personally identifying information in the interactive app.
- Use `lecture_session_id` and anonymous `participant_id` as the main data links.
- Keep `lecture_sessions` and `participants` public SELECT closed unless a later design explicitly proves it is safe.
- Use Supabase Edge Functions or narrow SECURITY DEFINER RPCs for sensitive operations.
- Treat SQL changes as manual-review artifacts. Codex may create SQL files, but the human runs them in Supabase SQL Editor.
- Build small, stable, phase-based features.

## Architecture Layers

The remaining MVP work should be divided into three layers.

### Layer 1: Display / UI Layer

This layer is mostly frontend UI and is comparatively safe.

Includes:

- PDF display area
- local PDF viewer
- fullscreen mode
- realtime comments display
- transcript area
- poll results display
- dark navy presentation layout
- wording and UX polish

### Layer 2: Realtime / Display Control Layer

This layer syncs presentation state between Admin and Display.

Includes:

- current PDF page sync
- display mode sync
- Admin slide controls
- Display-side Realtime subscription
- optional poll result refresh triggers

This layer may require a small DB table such as `lecture_display_state`.

### Layer 3: Admin Mutation Layer

This is the most sensitive layer because it changes database state.

Includes:

- lecture creation
- lecture code generation
- poll creation
- poll open / close
- lecture status changes

Do not implement this by simply exposing direct browser writes through the anon key. The Admin PIN gate alone is not enough. Database mutation should go through Supabase Edge Functions or carefully reviewed SECURITY DEFINER RPCs.

## Recommended Technical Roadmap

### Phase 1: Display UI Improvement

Status: mostly implemented.

Goal:

- Make `/display` useful for lab seminar screen sharing.

Current target layout:

- left top: 16:9 PDF slide area
- left bottom: script / transcript area
- right: realtime comments
- bottom: poll results

Completion criteria:

- large-screen readable
- dark navy / black theme
- comments and likes visible
- poll results visible
- transcript placeholder visible
- PDF placeholder visible
- no admin operation buttons on Display

### Phase 2: Local PDF Viewer

Status: implemented as a local-browser MVP.

Goal:

- Let the Display PC load a local PDF and show slides inside `/display`.

Recommended approach:

- Do not upload PDF to Supabase Storage for the MVP.
- Use a browser file input on the Display PC.
- Keep the PDF in browser memory.
- Add page state locally first.
- Supabase Storage upload, shared PDF persistence, and Admin-controlled PDF selection are later phases.

Technical candidates:

- `react-pdf`
- `pdfjs-dist`

Minimum implementation:

- PDF file input
- render page 1
- previous / next
- current page / total pages
- placeholder when no PDF is selected
- error state when PDF loading/rendering fails

Completion criteria:

- PDF can be selected locally
- first page renders
- previous / next works
- current page / total pages is visible
- comments / transcript / poll layout remains usable

### Phase 3: Fullscreen API

Status: implemented for the local Display MVP.

Goal:

- Make Display usable during actual presentation.

Display modes:

```ts
type DisplayMode = 'normal' | 'presentation' | 'slideOnly'
```

Mode behavior:

| Mode | PDF | Comments | Transcript | Poll |
| --- | --- | --- | --- | --- |
| normal | visible | visible | visible | visible |
| presentation | visible | visible | visible | hidden |
| slideOnly | visible | hidden | hidden | hidden |

Implementation notes:

- Use `Element.requestFullscreen()`
- Use `document.exitFullscreen()`
- Listen to `fullscreenchange`
- Keep UI state consistent after ESC exits fullscreen

Completion criteria:

- PDF-only fullscreen works
- PDF + transcript + comments fullscreen works
- ESC does not break state
- poll is hidden in presentation / slideOnly modes

Current implementation:

- `/display` has a PDF-only fullscreen control on the local PDF viewer.
- `/display` has a Display fullscreen control for the PDF, transcript, and realtime comments layout.
- Poll results stay on the normal page but are hidden during Display fullscreen.
- Fullscreen state listens to `fullscreenchange`, so browser ESC exit is reflected in the UI.

### Phase 4: Admin Slide Control

Status: implemented as the first Admin-to-Display realtime control layer.

Goal:

- Let the Admin PC control the Display PC slide page.

Important rule:

- Do not upload the PDF to Supabase for MVP.
- Sync only the current page and display mode.

Recommended table:

```sql
lecture_display_state
- lecture_session_id uuid primary key
- current_pdf_page integer
- display_mode text
- updated_at timestamptz
```

Flow:

- Admin clicks next / previous / go to page
- DB state updates
- Display subscribes to Realtime or polls the state
- Display PDF viewer changes page

Completion criteria:

- Admin can move previous / next
- Admin can go to a page
- Display page changes
- current page visible on Admin and Display
- PDF file itself remains local to Display PC

### Phase 5: Poll Operation Completion

Goal:

- Make poll operation reliable enough for the lab seminar.

MVP-acceptable option:

- Keep manual refresh / periodic refresh
- Use existing poll results RPC
- Keep poll responses raw SELECT closed

Optional enhancement:

- Subscribe to `poll_responses` INSERT events
- Use the event only as a trigger
- Re-fetch aggregate poll results through RPC

Completion criteria:

- poll answer works
- poll results show on `/lecture` and `/display`
- manual or periodic refresh is available
- docs clearly state poll Realtime status

### Phase 6: UX Copy Improvement

Goal:

- Make all screens understandable without verbal explanation.

Targets:

- `/join`
- `/lecture`
- `/admin`
- `/display`

Copy direction:

- `/join`: "Enter the Journal Club code"
- `/lecture`: "Ask questions anonymously during the talk"
- comments: "Write questions or points you want to discuss"
- poll: "Answer after or during the presentation"
- display: "AI transcript is a test placeholder"
- admin: clarify slide control, poll refresh, and display operation

Completion criteria:

- students can join without instruction
- Admin actions are clear
- Display text is short and natural

### Phase 7: Whole-UI Polish

Goal:

- Tune the app on actual devices.

Check:

- Display PC
- Admin PC
- smartphone
- Chrome / Edge
- lab Wi-Fi
- Zoom / projector screen sharing

Tune:

- font sizes
- comment density
- slide display area
- fullscreen margins
- poll result bars
- dark navy colors
- button locations
- loading / error states

### Phase 8: Admin Dashboard Lecture / Poll Management

Goal:

- Add real Admin operations for creating lectures and polls.

This is an Admin mutation system, not just UI.

Do not directly expose these as anon-key browser writes:

- `lecture_sessions INSERT`
- `lecture_sessions UPDATE`
- `polls INSERT`
- `poll_options INSERT`
- `polls UPDATE status`

Recommended architecture:

```text
Admin frontend
↓
Supabase Edge Function
↓
admin secret / service role / SECURITY DEFINER RPC
↓
database mutation
```

Recommended implementation order:

1. Admin mutation architecture design
2. create lecture Edge Function
3. lecture code generation
4. create poll Edge Function
5. poll open / close Edge Function
6. Admin UI integration
7. docs + runbook

Admin authentication options:

- MVP simple option: send PIN to Edge Function for each mutation
- stronger option: Edge Function returns a signed admin session token
- production option: Supabase Auth + admin role

MVP may use the simple option, but larger lecture deployment should move to a stronger model.

### Phase 9: Git / Cloudflare Deploy

Goal:

- Make the MVP available through a public URL rather than localhost.

Suggested path:

- `git init`
- GitHub private repository
- Cloudflare Pages project
- build command: `npm run build`
- output directory: `dist`

Cloudflare frontend env:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Do not put these in Cloudflare frontend env:

```env
OPENAI_API_KEY=
ADMIN_PIN=
SERVICE_ROLE_KEY=
DATABASE_PASSWORD=
```

Server-side secrets remain in Supabase.

Completion criteria:

- `/join`
- `/lecture`
- `/admin`
- `/display`

open from the deployed URL.

### Phase 10: OpenAI Live Transcript

Goal:

- Generate live English transcript from presenter microphone audio and display it in the script area.

Recommended architecture:

```text
Display browser
↓
Supabase Edge Function creates ephemeral OpenAI credential
↓
OpenAI Realtime transcription
↓
Display transcript area
```

Implementation outline:

- Supabase Secret: `OPENAI_API_KEY`
- Edge Function: `create-transcription-session`
- frontend receives only short-lived credential
- microphone permission
- transcript deltas
- start / stop
- timeout / fallback

Do not implement in the MVP transcript phase:

- Japanese translation
- transcript DB persistence
- student-device subtitle broadcast
- AI summary
- FAQ generation

## Immediate Next Implementation Proposal

The next implementation should be **Phase 2: Local PDF Viewer**.

Reason:

- Display UI is already present.
- It does not require DB mutation.
- It does not require admin RLS redesign.
- It gives the lab seminar the most visible improvement.
- It prepares the ground for fullscreen and Admin slide control.

Recommended next task:

```text
Implement local PDF viewer in /display.
Do not upload PDFs.
Do not add Supabase Storage.
Do not implement Admin slide sync yet.
Use local file input, currentPage, totalPages, Previous / Next.
Keep comments, transcript, and poll results visible in the existing Display layout.
Run typecheck/build/lint.
```

## Security Notes

- Admin PIN gate protects the Admin UI only.
- Admin PIN gate does not grant database-level admin authorization.
- Sensitive DB mutations must be protected server-side.
- RLS should not be weakened just to make Admin UI easier.
- `participants` public SELECT should remain closed.
- `poll_responses` raw SELECT should remain closed unless a narrow aggregate or ownership-safe design is added.
- OpenAI API key must remain server-side only.

## MVP Success Criteria

The lab seminar MVP succeeds if:

- students can join with `JC2026` or a generated lecture code
- comments work reliably
- likes work reliably
- polls can be answered
- poll results are visible
- Display is readable on a shared screen
- PDF slides can be displayed locally
- transcript area is ready for the OpenAI phase
- Admin can safely access admin-only screens
- no secrets are exposed in frontend code
