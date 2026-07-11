import assert from 'node:assert/strict'

const projectRef = process.env.SUPABASE_PROJECT_REF
const anonKey = process.env.SUPABASE_ANON_KEY
const adminPin = process.env.ADMIN_PIN

assert.ok(projectRef, 'SUPABASE_PROJECT_REF is required')
assert.ok(anonKey, 'SUPABASE_ANON_KEY is required')
assert.ok(adminPin, 'ADMIN_PIN is required')

const baseUrl = `https://${projectRef}.supabase.co`
const title = `M4 hosted E2E ${new Date().toISOString()}`

async function post(path, body, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
  const payload = await response.json()
  assert.equal(
    response.status,
    expectedStatus,
    `${path} returned ${response.status}: ${JSON.stringify(payload)}`,
  )
  return payload
}

const auth = await post('/functions/v1/verify-admin-pin', { pin: adminPin })
assert.equal(auth.ok, true)
assert.equal(typeof auth.adminToken, 'string')
const adminToken = auth.adminToken

const created = await post('/functions/v1/manage-lectures', {
  action: 'create',
  adminToken,
  title,
})
const lecture = created.lectures.find((item) => item.title === title)
assert.ok(lecture?.id)

const started = await post('/functions/v1/manage-lectures', {
  action: 'start',
  adminToken,
  lectureSessionId: lecture.id,
})
assert.equal(
  started.lectures.find((item) => item.id === lecture.id)?.status,
  'open',
)

const selected = await post('/functions/v1/update-display-state', {
  action: 'setDocument',
  adminToken,
  lectureSessionId: lecture.id,
  pdfDocumentId: 'm4-sample-v1',
})
assert.equal(selected.displayState.pdf_document_id, 'm4-sample-v1')
assert.equal(selected.displayState.current_pdf_page, 1)

const nextPage = await post('/functions/v1/update-display-state', {
  action: 'next',
  adminToken,
  lectureSessionId: lecture.id,
})
assert.equal(nextPage.displayState.current_pdf_page, 2)

const modeChanged = await post('/functions/v1/update-display-state', {
  action: 'setDisplayMode',
  adminToken,
  displayMode: 'presentation',
  lectureSessionId: lecture.id,
})
assert.equal(modeChanged.displayState.display_mode, 'presentation')

const invalidPage = await post(
  '/functions/v1/update-display-state',
  {
    action: 'goToPage',
    adminToken,
    currentPdfPage: 4,
    lectureSessionId: lecture.id,
  },
  400,
)
assert.match(invalidPage.message, /page count/)

const snapshot = await post('/rest/v1/rpc/get_lecture_live_snapshot', {
  target_lecture_session_id: lecture.id,
})
assert.equal(snapshot.lecture.status, 'open')
assert.equal(snapshot.display.pdf_document_id, 'm4-sample-v1')
assert.equal(snapshot.display.current_pdf_page, 2)
assert.equal(snapshot.display.display_mode, 'presentation')
assert.ok(snapshot.versions.display >= 3)

const closed = await post('/functions/v1/manage-lectures', {
  action: 'close',
  adminToken,
  lectureSessionId: lecture.id,
})
assert.equal(
  closed.lectures.find((item) => item.id === lecture.id)?.status,
  'closed',
)

console.log(
  JSON.stringify({
    invalidPageRejected: true,
    lectureClosed: true,
    pdfDocumentId: snapshot.display.pdf_document_id,
    pdfPage: snapshot.display.current_pdf_page,
    snapshotDisplayVersion: snapshot.versions.display,
    snapshotMode: snapshot.display.display_mode,
  }),
)
