# GAS Integration

Google Apps Script is intentionally out of scope for Phase 0.

## Intended Later Use

GAS may be used after the lecture to:

- Store Google Form responses in a Spreadsheet
- Group responses by lecture
- Generate summary reports
- Notify organizers
- Prepare follow-up material

## Boundary

GAS and Spreadsheet should not become the real-time database for Live Board, likes, polls, or classroom display state. Those features need a dedicated real-time backend in a later phase.

The Interactive app should only link students to a Google Form, optionally with a non-personal `lecture_id` parameter.
