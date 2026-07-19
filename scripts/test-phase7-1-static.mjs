import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import {
  buildLectureJoinUrl,
  createLectureJoinQrSvg,
  normalizeStandardLectureCode,
} from '../src/qr/lectureJoinQr.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260719114320_phase7_1_classroom_ux_extensions.sql')
const liveRepository = read('src/repositories/supabaseLiveStateRepository.ts')
const historyPage = read('src/pages/CommentHistoryPage.tsx')
const qrComponent = read('src/components/LectureJoinQr.tsx')
const generate = read('supabase/functions/generate-lecture-summary/index.ts')
const env = read('.env.local.example')

assert.match(env, /^VITE_PHASE7_1_CLASSROOM_EXTENSIONS=false$/m)
assert.match(env, /^PHASE7_1_CLASSROOM_EXTENSIONS_ENABLED=false$/m)
assert.match(migration, /summary_language text not null default 'auto'/)
assert.match(migration, /requested_language text not null default 'auto'/)
assert.match(migration, /security invoker/g)
assert.match(migration, /request_user_id uuid := \(select auth\.uid\(\)\)/)
assert.match(migration, /participant\.auth_user_id = request_user_id/)
assert.match(migration, /grant execute on function public\.get_lecture_comment_history_v3[\s\S]*to authenticated/)
assert.doesNotMatch(migration, /grant execute on function public\.get_lecture_comment_history_v3[\s\S]*to anon/)
assert.match(liveRepository, /scope = 'all'/)
assert.match(historyPage, /historyScope === 'mine'/)
assert.doesNotMatch(historyPage, /setInterval|setTimeout/)
assert.equal((generate.match(/https:\/\/api\.openai\.com\/v1\/responses/g) ?? []).length, 1)
assert.doesNotMatch(qrComponent, /fetch\(|supabase|cloudflare|r2/i)

assert.equal(normalizeStandardLectureCode(' 285463 '), '285463')
assert.equal(normalizeStandardLectureCode('JC1234'), null)
assert.equal(normalizeStandardLectureCode('12345'), null)
const joinUrl = buildLectureJoinUrl('285463', 'https://class.example.edu/admin?ignored=1')
assert.equal(joinUrl, 'https://class.example.edu/join?code=285463')
assert.doesNotMatch(joinUrl, /token|secret|#|admin/i)
const generated = await createLectureJoinQrSvg('285463', 'https://class.example.edu')
assert.equal(generated.joinUrl, joinUrl)
assert.match(generated.svg, /^<svg/)

// Decode a separately rasterized module matrix with an independent decoder.
const matrix = QRCode.create(joinUrl, { errorCorrectionLevel: 'M' }).modules
const quiet = 4
const scale = 8
const side = (matrix.size + quiet * 2) * scale
const pixels = new Uint8ClampedArray(side * side * 4).fill(255)
for (let row = 0; row < matrix.size; row += 1) {
  for (let column = 0; column < matrix.size; column += 1) {
    if (!matrix.get(row, column)) continue
    for (let y = (row + quiet) * scale; y < (row + quiet + 1) * scale; y += 1) {
      for (let x = (column + quiet) * scale; x < (column + quiet + 1) * scale; x += 1) {
        const offset = (y * side + x) * 4
        pixels[offset] = 16
        pixels[offset + 1] = 36
        pixels[offset + 2] = 62
      }
    }
  }
}
assert.equal(jsQR(pixels, side, side)?.data, joinUrl)

console.log('Phase 7.1 static security, on-demand history and independent QR decode checks passed.')
