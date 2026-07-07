# Journal Club Display Control

## Purpose

Admin-side Display Control lets the Admin browser control the Display browser's PDF page and display mode in realtime.

Only display state is synchronized:

- `current_pdf_page`
- `display_mode`
- `updated_at`

The PDF file itself is not uploaded or synchronized. The Display PC still loads the PDF locally through the browser file input.

## Database Setup

Run this SQL manually in Supabase SQL Editor:

```text
supabase/manual/create_lecture_display_state.sql
```

Then seed the Journal Club display state row:

```text
supabase/seed/003_seed_lecture_display_state.sql
```

The table is:

```text
lecture_display_state
- lecture_session_id
- current_pdf_page
- display_mode
- updated_at
```

RLS is enabled. Public frontend clients may `SELECT` this table so Display can subscribe to changes. Public frontend clients should not directly `INSERT`, `UPDATE`, or `DELETE`.

The Edge Function uses `service_role` for Admin mutations. The table therefore needs explicit `service_role` table privileges:

```sql
grant select, insert, update on public.lecture_display_state to service_role;
```

If Admin Slide Control returns `permission denied for table lecture_display_state`, run:

```text
supabase/manual/fix_lecture_display_state_service_role_grants.sql
```

## Edge Function

Admin writes go through:

```text
supabase/functions/update-display-state
```

Deploy it manually after reviewing the code. It requires server-side secrets:

```env
ADMIN_PIN=your-admin-pin
ADMIN_SESSION_SECRET=long-random-string-recommended
SUPABASE_URL=your-project-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Do not put these values in React, `.env.local`, or any frontend file.

`verify-admin-pin` now returns a short-lived signed Admin token. React stores that token in `sessionStorage` and sends it to `update-display-state`. The PIN itself is not stored in React.

## Display Flow

1. Display PC opens `/join` and joins the active lecture.
2. Display PC opens `/display`.
3. Display PC selects the local PDF file.
4. Display subscribes to `lecture_display_state` Realtime changes.
5. Admin changes page or mode from `/admin`.
6. Display receives the updated page and mode without reload.

## Admin Controls

`/admin` includes:

- Previous
- Next
- Go to page
- Display mode

Display modes:

```text
normal: PDF + transcript + comments + polls
presentation: PDF + transcript + comments
slideOnly: PDF only
```

## Manual Test Checklist

1. Run `create_lecture_display_state.sql`.
2. Run `003_seed_lecture_display_state.sql`.
3. Deploy `verify-admin-pin` and `update-display-state`.
4. Set `ADMIN_PIN`.
5. Set `ADMIN_SESSION_SECRET`.
6. Open Chrome `/admin`.
7. Open Edge `/display`.
8. Load the same local PDF on the Display PC.
9. Click Admin `Next`.
10. Confirm Display advances one page.
11. Click Admin `Previous`.
12. Confirm Display returns one page.
13. Use `Go to page`.
14. Confirm Display jumps to that page.
15. Switch `presentation` mode.
16. Confirm poll area is hidden.
17. Switch `slideOnly` mode.
18. Confirm only the PDF remains.
19. Test while Display fullscreen is active.

## Known MVP Limitation

Admin does not know the PDF's total page count because the PDF file is local to the Display browser. If Admin sends a page number beyond the loaded PDF's range, the Display viewer ignores it safely.
