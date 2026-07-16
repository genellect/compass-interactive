# Phase 6 human test checklist

These items are deliberately deferred because they require a person, physical
audio devices, multiple real browsers/accounts, educational judgment or hosted
infrastructure. They are not local-gate failures.

## Audio and real lecture behavior

- [ ] Run the previously deferred real microphone/WebRTC test with the teacher
  notice visible and a pre-approved maximum spend.
- [ ] Confirm Japanese/mixed-language caption segmentation and that completed
  local segments enter the correct five-minute recap window.
- [ ] Run a real 90-minute lecture and verify summaries at minutes 5 through 85,
  no new provider call at/after minute 90, and prompt closed-screen convergence.
- [ ] Put the Admin laptop to sleep across one or more boundaries, resume it and
  confirm catch-up uses local completed segments without duplicate charges.
- [ ] Close/reopen the Admin browser and confirm same-actor run resume rotates
  the token; a different Admin actor cannot resume or stop that run.

## Educational and accessibility review

- [ ] A teacher reviews at least ten recap/comment-pulse outputs for factual
  grounding, concision, neutrality and actual educational value.
- [ ] Confirm information-poor windows stay hidden and that keeping the previous
  useful summary feels better than adding a low-value card.
- [ ] Confirm an active comment-only window (three or more visible comments, or
  a comment gaining at least three likes) produces a useful neutral pulse while
  a quiet comment-only window remains a no-cost skip.
- [ ] Confirm academic candidates are genuinely scholarly questions, visible
  only to Admin and never presented as literature-backed answers in Phase 6.
- [ ] Test teacher correction/publish/hide/pin/unpin with keyboard only.
- [ ] Test student AI-support hide/show, focus order, screen-reader names,
  contrast, reduced-motion behavior and no forced scroll.
- [ ] Visually inspect common phone, tablet, laptop and classroom-display sizes.

## Publisher and hosted integration

- [ ] Pair the real local Publisher, publish a disposable valid PDF and confirm
  current page plus adjacent pages contribute while PDF bytes/text stay out of
  Supabase.
- [ ] Disconnect Publisher mid-lecture and verify transcript-only behavior and
  the teacher degradation message.
- [ ] Verify Hosted Edge request-body/timeout limits, organization privacy/data
  controls, current model access, rate limits and project budget immediately
  before rollout.
- [ ] Run Hosted DB Advisors after migration and inspect function/table grants.
- [ ] Run two authenticated students and two Admin sessions against Hosted;
  verify student ownership separation and Admin run-token actor separation.
- [ ] Run a 20-person canary, then review measured snapshot latency/bytes, Edge
  invocations, Batch conflicts, provider failures and actual spend.
- [ ] Model/observe a 300-person lecture before wider activation; Phase 6 must
  still add zero student requests and zero Realtime subscriptions.

## Production activation record

- [ ] Record backup reference, rollback owner and stop criteria.
- [ ] Record deployed migration/function/frontend revisions with all flags OFF.
- [ ] Record canary lecture, participant count, actual OpenAI cost and all human
  sign-offs.
- [ ] Enable Phase 6 flags only after the above checks pass. Do not enable
  Phase 1-6 production features piecemeal outside the combined rollout plan.
