# MVP Requirements

## Phase 0

Phase 0 creates the technical foundation only.

Included:

- Vite + React + TypeScript app
- React Router
- Pages: `/join`, `/lecture`, `/admin`, `/display`
- Shared TypeScript types
- Mock data
- Minimal UI
- Passing build and typecheck

Excluded:

- Database
- Authentication
- API server
- Real-time communication
- Lecture code verification
- Google integrations

## Phase 1 Candidate Scope

Phase 1 should implement mock-interactive behavior without a backend:

- Enter a lecture code and navigate to `/lecture`
- Create or reuse an anonymous local participant ID
- Add comments to the local Live Board state
- Like and unlike comments in local state
- Hide or show comments from the admin view
- Open and close mock polls from local state

The goal is to validate user flows before choosing Supabase or Firebase.
