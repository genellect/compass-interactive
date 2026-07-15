# Phase 5 requirements and threat model

Date: 2026-07-16
Scope: local implementation only; production, Hosted Supabase, Cloudflare and
feature flags remain unchanged.

## Requirements matrix

| Requirement                                                                                         | Phase 5 implementation                                                                                                                                                                                                     | Verification                                      |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| PDF publication is free of OpenAI calls                                                             | Phase 3 publication remains unchanged. Analysis exists only behind the explicit `MaterialAnalysisControl` action.                                                                                                          | static test; Publisher regression                 |
| Teacher explicitly chooses the immutable PDF version                                                | UI selects registered `lecture_pdf_documents`; Publisher returns exactly that local version; Edge recomputes every excerpt hash and the aggregate text hash.                                                               | Edge unit tests; pgTAP context binding            |
| PDF limits remain 15 MiB / 75 pages / 20,000 characters, no image/OCR                               | Existing Publisher validation is reused; Phase 5 accepts only the text-only extraction contract.                                                                                                                           | Publisher regression; Edge hash test              |
| Every paid action requires Billing PIN                                                              | `authorize-ai-start` issues a two-minute one-use grant scoped to the Admin actor, lecture and exact action. Initial analysis and every additional Poll request authorize separately.                                       | pgTAP; UI/static test                             |
| No API key or service role in the browser                                                           | Only `analyze-lecture-material` reads `OPENAI_API_KEY`; both secrets remain Edge-only.                                                                                                                                     | static scan                                       |
| Default OFF until the Phase 6 rollout                                                               | `VITE_PHASE5_MATERIAL_ANALYSIS=false` and `PHASE5_MATERIAL_ANALYSIS_ENABLED=false`.                                                                                                                                        | static test                                       |
| One structured material call creates an outline, summary, terms, page structure and Poll candidates | A single Responses API call uses strict JSON Schema and server-owned model/prompt/price settings.                                                                                                                          | mocked contract test; live provider contract test |
| Poll proposals include educational metadata and evidence                                            | Each proposal stores type, stem, options, answer IDs, explanation, objective, misconception target, difficulty, evidence pages/excerpt IDs, value and quality score.                                                       | schema constraints; pgTAP                         |
| Low-quality output need not be shown                                                                | Deterministic gates reject missing/mismatched evidence, invalid answers, duplicate options, near-duplicate questions, low quality score and personalized-risk wording. The entire call fails if too few proposals survive. | Edge unit tests                                   |
| AI output is never directly delivered to students                                                   | Phase 5 tables are Admin-only and absent from Realtime/snapshots. Adoption creates an ordinary `polls.status='draft'` row. Existing explicit Poll start remains separate.                                                  | RLS/GRANT pgTAP; static/load tests                |
| Additional Poll requests are bounded and explicit                                                   | They require an active analysis, explicit page range, new Billing PIN grant and the existing `poll_generation_limit`.                                                                                                      | pgTAP                                             |
| Phase 4.1 Batch concurrency remains authoritative                                                   | `material_analysis` and `poll_suggestions` use the existing one-operation Batch lane and global two-lane ceiling.                                                                                                          | full Phase 4.1 and Phase 5 pgTAP                  |
| Lecture end wins over provider latency                                                              | Completion delegates to the Phase 4.1 finish transition; closed/expired/stopped lectures reject and discard late results. Unreviewed proposals expire on close.                                                            | pgTAP                                             |
| Retry cannot double-charge or duplicate rows                                                        | A server-generated idempotency key binds ledger and context. State lookup returns completed results, reports running work, and requires a fresh Billing PIN after terminal failure. Completion is atomic and idempotent.   | pgTAP                                             |
| Supabase does not store extracted PDF source text                                                   | Only hashes, document/version IDs and structured model output are stored.                                                                                                                                                  | information-schema pgTAP; static scan             |
| Student load does not scale with Phase 5                                                            | No Phase 5 table is in Realtime or student snapshots; all calls are teacher initiated.                                                                                                                                     | 20/300 load invariant test                        |

## Threat model

| Threat                                                | Defense                                                                                                                                                        | Residual risk / operation                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser tampers with extracted text                   | Edge recomputes per-page excerpt IDs and canonical `text_sha256`, then compares them with registered PDF metadata.                                             | A compromised teacher PC can still expose its own local text; protect the workstation and Publisher session.                                    |
| Prompt injection inside a PDF                         | PDF text is placed only in the user data object; a developer instruction declares it untrusted. No tools, files, image input or background mode are enabled.   | Model-level attacks cannot be eliminated; deterministic evidence and quality gates remain mandatory.                                            |
| Browser selects a cheaper model, price or reservation | Model, prompt version, price snapshot, token ceilings and reservations are constructed by Edge, never accepted from the browser. DB rejects under-reservation. | Prices may change; re-confirm immediately before production rollout.                                                                            |
| Stolen Billing grant                                  | Grant is short-lived, one-use, nonce-hashed and bound to lecture, Admin session actor and exact action.                                                        | Existing Admin session authentication remains a global educator boundary; stronger teacher identity remains a later hardening item.             |
| Duplicate request after a lost response               | Operation state is checked by actor + lecture + feature + idempotency key before grant consumption. Running work is not replayed against the provider.         | A provider success followed by Edge termination before DB completion is conservatively marked failed/stale and requires an explicit paid retry. |
| Provider returns output after lecture close           | The result and usage completion share one DB transaction; the authoritative lecture guard converts late success to `discarded` and inserts no result.          | Provider usage is still billable even when the result is discarded.                                                                             |
| Service-role function is called with another actor    | Dedicated start/finish/fail functions compare `requested_by_actor`; public wrappers are SECURITY INVOKER and executable only by `service_role`.                | A leaked service role remains catastrophic; it must stay only in Hosted Edge secrets.                                                           |
| Student reads Admin output directly                   | Tables have RLS enabled, no browser policies and explicit `anon`/`authenticated` revokes. RPC execution is service-role-only.                                  | Admin Edge responses must never be exposed from a student route.                                                                                |
| AI silently opens a Poll                              | Adoption can create only `single`/`multiple` ordinary Polls and `admin_create_poll` fixes status to `draft`.                                                   | Teacher must still inspect and explicitly start the Poll.                                                                                       |
| Large teacher workload increases DB or Realtime cost  | One analysis plus at most five explicit additional calls; small structured rows; no student or Realtime fan-out.                                               | Model output size and Admin history should be measured after real teaching use.                                                                 |

## Security invariants

- Public Phase 5 RPC wrappers are `SECURITY INVOKER`.
- Private mutation primitives are `SECURITY DEFINER`, fix `search_path=''`,
  validate the explicit actor and have no browser grant.
- Canonical lock and state order remains Billing grant -> lecture -> AI control ->
  usage ledger. OpenAI is called only after the DB transaction commits and never
  while database locks are held.
- New foreign keys use `ON DELETE RESTRICT`; lookup and review paths have
  explicit indexes.
- Phase 0 `auth.uid()` participant ownership and all student RLS policies are
  untouched.

## Sources used for the implementation choice

- OpenAI model and price snapshot:
  <https://developers.openai.com/api/docs/models/gpt-5.6-luna>
- Structured Outputs contract:
  <https://developers.openai.com/api/docs/guides/structured-outputs>
- Current model prompting and reasoning controls:
  <https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6>
- Data controls and Responses retention behavior:
  <https://developers.openai.com/api/docs/guides/your-data>
- Supabase local migration/testing workflow:
  <https://supabase.com/docs/guides/local-development/cli/testing-and-linting>
