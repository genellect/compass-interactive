# Phase 6.5 Human Test Checklist

Automated repository, migration, RLS, upgrade, load, lint, and production-build
checks are complete. The following visual and assistive-technology checks
remain for a human browser session.

## Demo desktop

- Open `/join`, enter demo mode, and confirm the nickname checkbox starts
  unchecked.
- Confirm anonymous seed comments display `匿名の参加者`.
- Check `ニックネームをつける`; confirm the field says `10文字まで` and
  the counter starts at `0/10`.
- Enter 10 Japanese characters and confirm an 11th character is not retained.
- Repeat with emoji and confirm 10 emoji are retained as 10 characters.
- Submit a named comment and confirm the optimistic and settled card show the
  same nickname.
- Submit with the checkbox unchecked and confirm `匿名の参加者`.
- Reload and confirm both demo comments remain with the correct nullable
  nickname behavior.
- Confirm no horizontal overflow, clipped labels, or collision with the
  comment counter and submit button.

## Demo mobile

- Repeat at 390 x 844 or an equivalent small viewport.
- Confirm the checkbox, field, counter, privacy text, and submit button remain
  keyboard/touch accessible.
- Confirm a 10-character nickname wraps or truncates safely without pushing
  the timestamp or like controls outside the card.

## Live local two-user test

- Keep the production flag unchanged; enable the Phase 1 and Phase 6.5 flags
  only in a temporary local environment.
- Join one local lecture from two separate browser profiles.
- Post anonymous and named comments from each participant.
- Confirm both clients receive the same nickname through the five-second
  snapshot, without a Realtime comment subscription.
- Attempt to submit after teacher close and confirm the UI converges to the
  ended state and the server rejects the insert.
- Confirm archived preview retains the nickname beside its comment.

## Accessibility and content safety

- Navigate the nickname checkbox and field using keyboard only.
- Confirm the checkbox label and the `0/10` counter are announced sensibly by a
  screen reader.
- Confirm the personal-information warning is visible in live mode.
- Confirm high-contrast/light theme makes named and anonymous authors legible.
