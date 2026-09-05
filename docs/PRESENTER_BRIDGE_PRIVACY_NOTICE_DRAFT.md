# COMPASS Presenter Bridge privacy notice (draft)

Draft date: 2026-09-06. Publisher: Yuto Matsui. This notice is based on the
current Bridge, Presenter Gateway, Edge Function and database migrations. It
requires owner/legal review, an owner-approved contact method and a stable
public URL before Microsoft Store submission.

## What the Bridge does

COMPASS Presenter Bridge is a Windows companion application that observes the
currently displayed slide in a saved Microsoft PowerPoint presentation and
sends bounded synchronization metadata to the authorized COMPASS Interactive
service. It runs only after the educator pairs it with a prepared COMPASS
lecture.

## Data exchanged with the hosted COMPASS service

The Bridge sends the following in HTTPS request headers or bodies to the
dedicated COMPASS Presenter Gateway when inspecting, pairing, synchronizing or
disconnecting:

- a SHA-256 fingerprint of a per-Windows-user P-256 public signing key, the
  public key itself, a request signature, a random request nonce and the request
  timestamp;
- a SHA-256 hash of the saved PPTX file and a SHA-256 hash of the ordered
  PowerPoint slide IDs;
- slide count, hidden-slide count and whether a custom or partial show is in
  use during inspection;
- the current PowerPoint slide ID, slide index/PDF page number, a random event
  ID and a monotonic sequence number during page synchronization;
- a Presenter connection ID and the lecture/document binding carried by the
  signed pairing ticket or Presenter capability; and
- short-lived pairing or manual-recovery credentials and a short-lived
  Presenter capability token needed to authenticate the connection. Raw
  credentials are used in transit and are not designed to be stored in the
  Presenter connection tables.

The Gateway returns the bound lecture-session ID, PDF document ID, PDF document
version hash, PDF manifest version, PDF page count, connection state and
connection/expiry timestamps. Subsequent capability tokens carry the connection,
installation and lecture binding. These values are exchanged only to bind the
local slideshow to the prepared lecture and enforce its lifetime.

The hosting path can receive ordinary network metadata such as source IP
address and user-agent text. The current Presenter Edge path derives a keyed
hash from a trusted network identifier for rate limiting; the database stores
that hash, not the raw address, in the Presenter rate-limit table. Provider
platform logs and their retention must be checked and documented before this
notice is published.

## Local browser exchange

The authorized COMPASS browser sends a lecture-session ID, PDF document ID,
PDF document version and PDF page count, together with a short-lived pairing
ticket, to the Bridge at `http://127.0.0.1:43124`. The Bridge returns eligibility
state, a local deck-binding digest, slide count/current index and the saved
file's display name to that same exact-Origin-protected localhost session. The
file name is not included in the Bridge's hosted Presenter requests.

## Data the Bridge does not send to the hosted service

The current Bridge does not send the PPTX file, slide text, speaker notes,
images, audio, video, the local file path, the PowerPoint file name, Microsoft
PowerPoint account details, Microsoft account credentials, or student personal
information. It does not read or upload a PowerPoint account. As described
above, the file display name is confined to the local loopback/browser exchange.

This statement is specific to the Bridge transport. The paired COMPASS web
service has separate educator, lecture and student data handling described by
the COMPASS privacy materials.

## Why the data is used

The metadata is used to:

- verify that the PowerPoint deck remains bound to the published lecture PDF;
- authenticate the installed Bridge and reject replayed or altered requests;
- update the lecture's current PDF page;
- enforce lecture ownership, expiry, rate and safety controls; and
- diagnose lifecycle state without storing slide content or per-page movement
  as a separate audit event.

The current design does not use Bridge metadata for advertising or model
training.

## Storage and retention implemented in the current schema

The current database stores Presenter connection metadata including the
lecture/document identifiers, public-key material and fingerprint, deck/order
hashes, counts, last slide/page values, event/sequence identifiers and lifecycle
timestamps. Raw pairing tickets, raw manual codes and raw capability tokens are
represented by one-way hashes in the Presenter connection row.

When a connection ends, its connection row is marked revoked. The scheduled
cleanup function is designed to delete revoked connection rows after 30 days;
their low-frequency lifecycle events are deleted with the connection. The
30-day statement applies only after `revoked_at`, not from initial collection,
and it depends on the one-minute cleanup job remaining healthy.

Replay receipts contain public-key and nonce hashes, a request-body hash,
action, timestamps and the already returned bounded service response. They
expire after 10 minutes and the scheduled cleanup deletes expired receipts.
Keyed-hash rate-limit buckets are deleted after 10 minutes without an update.
The cleanup-health row retains aggregate last-run and backlog timestamps; no
fixed deletion period is currently defined for that single operational row.

Hosted log retention, backups, disaster-recovery copies and any processor-level
retention are not established by these migrations. The owner must verify them
against the deployed Supabase and Cloudflare configuration before publishing a
retention promise. A legal hold or mandatory-law exception, if applicable,
must be added by legal review rather than inferred here.

## Data on the Windows device

The Bridge stores a signing-only, per-user P-256 private key in the Windows CNG
user key store as non-exportable key material. Only its public key is sent. A
session capability remains in process memory and is not restored after a Bridge
restart. The Store-packaged build must be tested to confirm update and uninstall
behavior for the CNG key and any per-user settings before the final notice says
that uninstall removes all local data.

## Sharing and processors

Bridge metadata is processed only to operate and protect the COMPASS Presenter
service. The current architecture uses Microsoft for Store distribution,
Cloudflare for the Presenter Gateway/network edge and Supabase for the Edge
Function and PostgreSQL service. The final notice must identify the deployed
processors, applicable regions and any legally required disclosures after
owner review. The Bridge does not send presentation content to Microsoft merely
because it was installed from the Microsoft Store.

## Choices, access and contact

An educator can stop synchronization or disconnect the Bridge. Ending a
lecture, revoking the Admin session, changing the bound document or disabling
the feature also terminates the connection. A final notice must provide the
applicable access, deletion, correction and complaint process and an
owner-approved privacy contact. Requests may be limited where the record is a
security hash that cannot reasonably be linked back without the associated
authorized lecture context, subject to applicable law.

## Changes

The final notice must carry an effective date and a version history. Any change
to the transmitted fields, retention jobs, subprocessors, Store package or
authentication flow requires a fresh code/configuration review before the
notice is updated.

## Verification sources in this repository

- `presenter-bridge/src/Compass.Presenter.App/EdgePresenterClient.cs`
- `presenter-bridge/src/Compass.Presenter.App/PresenterRequestSigner.cs`
- `presenter-bridge/src/Compass.Presenter.PowerPoint.External/PowerPointComObservationSource.cs`
- `supabase/functions/presenter-bridge-session/index.ts`
- `supabase/migrations/20260801075917_phase7_29_powerpoint_presenter_bridge.sql`
- `supabase/migrations/20260809133000_phase7_29c_presenter_proof_and_cleanup.sql`
- `supabase/migrations/20260905074220_presenter_bound_authority_and_terminal_lease.sql`
