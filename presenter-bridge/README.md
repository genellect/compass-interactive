# COMPASS Presenter Bridge (Phase 7.29)

This directory is the Windows-only, per-user native boundary for PowerPoint
page synchronization. It is feature-flagged OFF and is not a production
release artifact yet.

## Runtime contract

- Attaches only to an already-running PowerPoint process; it never launches or
  closes PowerPoint.
- Treats the observed `View.Slide` state as authoritative. COM events only
  accelerate a 200 ms reconciliation loop.
- Requires a normal, windowed, all-slides show, Presenter View OFF, no hidden
  slides, and an exact PowerPoint/PDF page-count match.
- Freezes the PPTX SHA-256 and ordered Slide ID SHA-256 for the connection.
  Reordering, adding, deleting, hiding, or replacing slides stops updates.
- Exposes only `http://127.0.0.1:43124`, with exact Host and Origin checks,
  bounded JSON, Private Network Access preflight handling, and an in-memory
  browser-session token.
- Sends the signed pairing ticket and short-lived bearer capability only in
  HTTPS request bodies.
  They are never placed in a URL, command line, browser storage, or log.
- Uses a five-second remote timeout, no redirects, no cookies, and fails closed
  when Hosted validation or heartbeat rejects the connection.
- Pins the remote session endpoint to the canonical COMPASS Supabase host.
- Faults the session after bounded slideshow loss or COM observation timeout,
  allowing the coordinator to revoke the hosted fence.
- Stores only a random installation identity in Windows Credential Manager;
  the server receives its SHA-256 digest.
- Uses a per-Windows-user mutex and releases COM objects during safe shutdown.

## Non-secret runtime configuration

The signed installer must set:

- `COMPASS_PRESENTER_SESSION_ENDPOINT` to the exact HTTPS URL ending in
  `/functions/v1/presenter-bridge-session`.
- `COMPASS_PRESENTER_ALLOWED_ORIGINS` to a semicolon-separated exact Origin
  allowlist. If omitted, only `https://compass-interactive.pages.dev` is used.

Do not put a pairing ticket, capability, Admin token, API key, or service-role
key in either value.

The current installation digest is mismatch metadata, not cryptographic proof
of possession. Asymmetric per-install request signing remains mandatory before
feature activation.

## Gate status

Source is retained in the canonical GitHub repository for cross-platform review
and Windows CI compile/testing. Windows Application Control blocked an unsigned
generated test assembly on the former development workstation on 2026-08-01;
do not disable or bypass that control. CI does not distribute its unsigned
outputs. Code signing, per-user installer/update behavior, SmartScreen
reputation, PowerPoint 32/64-bit Office-build coverage, 500-transition real-
PowerPoint testing, and Edge/Chrome HTTPS-to-loopback device testing remain
Device/Human/Hosted Gate requirements.
