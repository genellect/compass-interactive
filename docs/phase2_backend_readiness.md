# Phase 2 Backend Readiness

Phase 1.5 refactors COMPASS Interactive without connecting any external backend. The app still runs entirely in the browser with React state and mock data, but the code is now organized around boundaries that can later be replaced by Supabase or Firebase.

## What Was Refactored

- Domain update logic moved into `src/services/compassActions.ts`.
- Repository interfaces were added under `src/repositories/`.
- `mockCompassRepository` now acts as the current in-browser backend.
- `CompassStateContext` keeps React state, but delegates lecture join, participant restore, comment actions, moderation, and poll actions to repository/service functions.
- Page components now read derived state such as `visibleComments`, `openPolls`, and `hiddenCommentCount` from context instead of recalculating every behavior locally.

## Interfaces Ready for Future Backend Implementation

The following interfaces define the future backend boundary:

- `LectureRepository`
  - get lecture session
  - get expected lecture code
  - validate lecture code
- `ParticipantRepository`
  - restore/persist anonymous participant ID
  - join lecture
- `CommentRepository`
  - list visible comments
  - create comments
  - toggle likes
  - hide/show comments
  - pin/unpin comments
- `PollRepository`
  - list polls
  - list open polls
  - submit poll responses
  - set poll status

These are currently synchronous and backed by local state. A Supabase or Firebase implementation may introduce async functions in Phase 2, at which point the context can become async-aware without changing page components much.

## What Still Remains Local-Only

- Comments are stored only in React state.
- Poll responses are stored only in React state.
- Poll open/close state is stored only in React state.
- Admin moderation state is stored only in React state.
- The participant ID is the only value persisted to `localStorage`.

This is intentional. Phase 1.5 prepares the backend boundary; it does not fake backend persistence.

## What Should Be Implemented in the Actual Backend Phase

1. Choose Supabase or Firebase Firestore.
2. Create backend repository implementations matching the current interfaces.
3. Add tables/collections for:
   - lecture sessions
   - participants
   - comments
   - comment likes
   - polls
   - poll options
   - poll responses
4. Replace the mock repository with the backend repository through a small provider or adapter.
5. Decide which reads are real-time subscriptions and which can use polling.
6. Keep student views scoped to visible comments, current open polls, and the participant's own response state.
7. Add minimal admin authentication before exposing moderation or poll controls in production.

## Explicit Non-Goals for Phase 1.5

- Supabase setup
- Firebase setup
- Google Apps Script
- Google Form integration
- Google Spreadsheet integration
- API server
- WebSocket
- Production authentication
- QR code generation
