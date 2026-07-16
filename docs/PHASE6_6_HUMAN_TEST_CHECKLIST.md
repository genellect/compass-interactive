# Phase 6.6 Human and Hosted Test Checklist

These tests are intentionally not automated with production credentials.
Complete them in a controlled canary before enabling Phase 6.6 for normal use.

## Admin and PDF publication

- Sign in with the real management PIN; confirm the API PIN remains separate.
- Confirm only two recent lectures are initially visible and the history toggle
  retrieves older lectures.
- Duplicate/restart a closed lecture; confirm a new six-digit code and record
  are created and the old archive remains unchanged.
- Start the local Publisher from the approved directory.
- Complete the one-time eight-digit pairing and verify the main CTA subsequently
  publishes without exposing technical terminology.
- Upload a valid text PDF and confirm Admin preview, current page, student
  inline view and optional download.
- Reject MIME spoofing, textless/image-only PDF, over 15 MB, over 75 pages and
  over 20,000 extracted characters.
- Confirm PDF bytes, extracted text and R2 credentials never appear in
  Supabase or browser storage.

## Student devices

- Use at least two independent browsers/users and confirm ownership isolation.
- Confirm a live six-digit code joins and an ended code opens the R2 archive
  without creating a new Supabase participant.
- On a 390 px phone, verify PDF is first, captions appear only while fresh,
  five comments precede the composer, and Poll/recap/summary/exit follow.
- Verify the fixed mobile navigation does not obscure interactive content when
  scrolled to each section.
- Post anonymously and with a nickname; confirm the nickname is stored with the
  comment only.
- Attempt an eleventh nickname character and confirm the inline red warning.
- Open comment history and verify no five-second loop runs there.
- Exit the lecture and confirm polling/pending sends stop; re-enter with the
  code and confirm the owned participant row is reused.

## Participant count and moderation

- Join/leave with multiple devices and confirm the displayed count is clearly
  approximate and converges within the 90-second presence window.
- Confirm one browser causes no more than one presence write per 45 seconds.
- Hide, restore, pin and unpin comments from Admin.
- Confirm hidden comments and hidden-comment counts never appear on student or
  classroom display.
- Confirm the moderation audit records actor, action, before/after state and
  timestamp.

## Poll, summaries and cost controls

- Confirm only one Poll can be open under two simultaneous Admin attempts.
- Confirm the open Poll plus five recent closed Polls are initially visible.
- Review and publish a material summary; confirm hidden/unreviewed output is not
  forced onto the student screen.
- Start/stop summaries and material analysis with the API PIN and confirm stop
  needs no PIN.
- Confirm information-poor windows skip the provider call.
- Confirm actual and reserved costs shown in the daily digest match the usage
  ledger.

## Realtime microphone

- With an approved cost ceiling, run a real microphone test for 10 minutes.
- Repeat for 30 minutes only if the 10-minute test passes.
- Confirm no other AI CTA starts Realtime.
- Confirm audio is not saved by COMPASS and local review text can be deleted.
- Confirm the browser receives only an SDP answer, never an OpenAI key.
- Confirm manual stop, selected-duration expiry and lecture close each stop
  local audio immediately and terminate the provider call.
- Simulate one provider hangup failure and confirm the one-minute sweep retries
  without a second provider call or duplicate charge.
- Confirm delayed caption windows cannot replace a newer sequence.

## Archive, Cloudflare and Turnstile

- Validate the exact production Origin and Turnstile hostname/action.
- Confirm unknown code, closed live join and invalid Turnstile responses are
  generic.
- Trigger the failed-code guard with repeated misses; confirm a valid archive
  from the same simulated NAT still works.
- Wait for an archive token to expire and confirm PDF access renews through a
  fresh Turnstile lookup without storing the token.
- Confirm archive cleanup observes the recovery buffer and is idempotent.

## Classroom display

- Open classroom display from Admin and confirm the display token is removed
  from the URL fragment immediately.
- Confirm the token is lecture-scoped and cannot read another lecture.
- Confirm the white fullscreen layout keeps the PDF, active Poll and recent
  visible comments readable at projector distance.
- After lecture close or live-token expiry, confirm the display receives only
  terminal lifecycle state and stops polling.

## Daily digest and schedules

- Verify sender domain and `Reply-To`.
- Run archive export every two minutes, Realtime hangup sweep every minute and
  daily digest at 20:00 JST using three distinct trigger secrets.
- On a day with no activity, confirm no email is sent.
- On an active day, confirm exactly one email is sent to
  `matsui.yuto@st.kitasato-u.ac.jp`.
- Retry a provider timeout and confirm the email idempotency key prevents a
  duplicate.

## Accessibility and canary

- Keyboard-only flow for Join, comment, Poll, history, exit and Admin controls.
- Screen reader labels and announcements for connection, validation and
  lecture-ended state.
- Contrast, 200% zoom and reduced-motion checks.
- Visual review at 390 px, tablet, desktop and classroom fullscreen.
- Run a measured 20-person Free-plan canary.
- Review actual latency, errors, database CPU/egress, Worker/R2 operations and
  API spend before the approximately 300-person Pro-plan activation.
