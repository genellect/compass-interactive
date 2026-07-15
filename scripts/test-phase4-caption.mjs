import assert from 'node:assert/strict'
import {
  appendCompletedCaptionSegment,
  createCaptionWindow,
  normalizeCaptionText,
} from '../src/caption/captionWindow.ts'
import { createTranscriptExport } from '../src/caption/captionTranscriptStore.ts'
import { parseRealtimeEvent } from '../src/caption/realtimeCaptionSession.ts'

const now = Date.parse('2026-07-15T00:01:00.000Z')
const base = {
  language: 'ja',
  lectureSessionId: 'lecture-1',
}
let segments = []
segments = appendCompletedCaptionSegment(segments, {
  ...base,
  completedAt: '2026-07-15T00:00:20.000Z',
  itemId: 'item-2',
  sequence: 2,
  startedAt: '2026-07-15T00:00:16.000Z',
  text: '  二つ目   の字幕。 ',
})
segments = appendCompletedCaptionSegment(segments, {
  ...base,
  completedAt: '2026-07-15T00:00:18.000Z',
  itemId: 'item-1',
  sequence: 1,
  startedAt: '2026-07-15T00:00:14.000Z',
  text: '最初の字幕。',
})
assert.deepEqual(
  segments.map((segment) => segment.itemId),
  ['item-1', 'item-2'],
  'completion events are rendered in first-seen sequence order',
)
assert.equal(segments[1].text, '二つ目 の字幕。')

segments = appendCompletedCaptionSegment(segments, {
  ...base,
  completedAt: '2026-07-15T00:00:21.000Z',
  itemId: 'item-2',
  sequence: 2,
  startedAt: '2026-07-15T00:00:16.000Z',
  text: '訂正済み字幕。',
})
assert.equal(segments.length, 2, 'a completed item is idempotently replaced')
assert.equal(segments[1].text, '訂正済み字幕。')

const window = createCaptionWindow(segments, now)
assert.deepEqual(window, {
  language: 'ja',
  lastItemId: 'item-2',
  sequence: 2,
  text: '最初の字幕。 訂正済み字幕。',
})
assert.equal(
  createCaptionWindow(
    [
      {
        ...segments[0],
        completedAt: '2026-07-14T23:59:00.000Z',
      },
    ],
    now,
  ),
  null,
  'segments older than 45 seconds are not sent to students',
)
assert.equal(
  createCaptionWindow([{ ...segments[0], text: 'x'.repeat(1_200) }], now).text
    .length,
  1_000,
  'student caption payload is capped at 1000 characters',
)
assert.equal(normalizeCaptionText(' a\n\tb  '), 'a b')

assert.deepEqual(
  parseRealtimeEvent(
    JSON.stringify({
      delta: '講義',
      item_id: 'item-3',
      type: 'conversation.item.input_audio_transcription.delta',
    }),
  ),
  { delta: '講義', itemId: 'item-3', type: 'delta' },
)
assert.deepEqual(
  parseRealtimeEvent(
    JSON.stringify({
      item_id: 'item-3',
      transcript: '講義字幕',
      type: 'conversation.item.input_audio_transcription.completed',
    }),
  ),
  { itemId: 'item-3', transcript: '講義字幕', type: 'completed' },
)
assert.equal(parseRealtimeEvent('{invalid'), null)

const txt = await createTranscriptExport(segments, 'txt').text()
const jsonl = await createTranscriptExport(segments, 'jsonl').text()
assert.match(txt, /最初の字幕/)
assert.equal(jsonl.split('\n').length, 2)
assert.doesNotMatch(jsonl, /audio|blob|clientSecret|apiKey/i)

console.log(
  'Phase 4 caption ordering, windowing, parsing, and export tests passed.',
)
