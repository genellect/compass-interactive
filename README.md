# COMPASS Interactive

COMPASS Interactive is a real-time classroom participation system for pharmacy English lectures and related COMPASS learning events.

Phase 0 establishes the application foundation only:

- Vite + React + TypeScript
- React Router routes for `/join`, `/lecture`, `/admin`, and `/display`
- Shared TypeScript domain types
- Mock lecture, participant, comment, poll, and response data
- Minimal responsive UI for future implementation

This repository is intentionally independent from the existing COMPASS official website. The official site can later link to this application by URL or QR code without coupling release cycles.

## Scripts

```powershell
& "C:\Program Files\nodejs\npm.cmd" run dev
& "C:\Program Files\nodejs\npm.cmd" run build
& "C:\Program Files\nodejs\npm.cmd" run typecheck
& "C:\Program Files\nodejs\npm.cmd" run preview
```

## Phase 0 Boundaries

Not implemented in Phase 0:

- Supabase / Firebase
- Google Apps Script
- Google Form or Spreadsheet integration
- Authentication or admin login
- WebSocket or real-time transport
- API server
- Production database
- QR code generation
- Real lecture code verification

The app uses `src/lib/mockData.ts` only.
