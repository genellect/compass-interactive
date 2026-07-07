# Architecture

## Current Phase 0 Architecture

```text
React + TypeScript frontend
  ├─ /join
  ├─ /lecture
  ├─ /admin
  └─ /display
        ↓
Mock data only
```

There is no backend, API server, database, authentication, or real-time transport in Phase 0.

## Target Architecture

```text
COMPASS Web
  ↓
COMPASS Interactive URL / QR
  ↓
React + TypeScript app
  ├─ Student view
  ├─ Lecturer/admin dashboard
  └─ Read-only display view
        ↓
Realtime backend in a later phase
        ↓
Post-lecture Google Form / GAS / Spreadsheet
```

## Frontend Structure

- `src/pages/`: route-level page components
- `src/components/`: reusable display components
- `src/types/`: domain model types
- `src/lib/mockData.ts`: Phase 0 mock data source
- `src/hooks/`: reserved for later reusable state hooks

## Data Boundary

Interactive data should remain anonymous. Named evaluations and formal feedback belong to Google Form / GAS / Spreadsheet after the lecture.
