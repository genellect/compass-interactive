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
  HTTPS request bodies. Every request also carries a per-user P-256 proof bound
  to the exact raw body, method, fixed path, timestamp and random nonce. They
  are never placed in a URL, command line, browser storage, or log.
- Uses a five-second remote timeout, no redirects, no cookies, and fails closed
  when Hosted validation or heartbeat rejects the connection.
- Pins the remote session endpoint to the dedicated COMPASS Presenter Gateway.
  The current Release placeholder is `presenter-api.invalid`, so the app fails
  closed until an owner-approved FQDN is compiled into a signed candidate.
- Faults the session after bounded slideshow loss or COM observation timeout,
  allowing the coordinator to revoke the hosted fence.
- Stores a signing-only, user-scoped, non-exportable P-256 key in the Windows
  CNG user key store; the server receives only its public SPKI and SHA-256
  fingerprint.
- Uses a per-Windows-user mutex and releases COM objects during safe shutdown.

## Non-secret runtime configuration

The signed release must compile the exact owner-approved Presenter Gateway host.
Release builds do not accept an environment override for that endpoint. Debug
builds may read `COMPASS_PRESENTER_SESSION_ENDPOINT`, but it remains subject to
the same exact HTTPS host/default-port/path validator.

Debug builds may set:

- `COMPASS_PRESENTER_ALLOWED_ORIGINS` to a semicolon-separated exact Origin
  allowlist. If omitted, only `https://compass-interactive.pages.dev` is used.

Signed Release builds always pin the canonical production Origin and ignore
this environment variable. A staging or contest build must use a separately
reviewed compile-time channel rather than a teacher-machine override.

Do not put a pairing ticket, capability, Admin token, API key, or service-role
key in either value.

The complete Gateway, signing, update-feed, five-minute manual recovery-code TTL
and activation gate is documented in
`../docs/PHASE7_29C_SIGNED_PRESENTER_ACTIVATION.md`.

## Gate status

Source is retained in the canonical GitHub repository for cross-platform review
and Windows CI compile/testing. Windows Application Control blocked an unsigned
generated test assembly on the former development workstation on 2026-08-01;
do not disable or bypass that control. CI does not distribute its unsigned
outputs. Exact Gateway FQDN/route, code signing, per-user installer/update
behavior, SmartScreen reputation, PowerPoint 32/64-bit Office-build coverage,
500-transition real-PowerPoint testing, and Edge/Chrome HTTPS-to-loopback
device testing remain Device/Human/Hosted Gate requirements.
