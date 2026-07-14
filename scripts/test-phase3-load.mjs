import assert from 'node:assert/strict'

const lectureSeconds = 90 * 60
const liveStateIntervalSeconds = 5
const materialChanges = 3
const pdfRangeRequestsPerMaterial = 16
const adminPageChanges = 60
const retentionFeedInvocations = 4

function modelPhase3(students) {
  const existingLiveStateRequests =
    (lectureSeconds / liveStateIntervalSeconds) * students
  const supabaseTokenInvocations = students * materialChanges
  const supabasePdfMetadataWrites = materialChanges
  const supabaseLiveStateWrites = adminPageChanges + materialChanges
  const workerManifestRequests = students * materialChanges
  const workerTicketRequests = students * materialChanges
  const r2PdfReads = students * materialChanges * pdfRangeRequestsPerMaterial

  return {
    existingLiveStateRequests,
    mainAppRedeploysPerPdf: 0,
    pdfBytesStoredInSupabase: 0,
    realtimeSubscriptionsAdded: 0,
    retentionFeedInvocations,
    r2PdfReads,
    students,
    supabaseLiveStateWrites,
    supabasePdfMetadataWrites,
    supabaseTokenInvocations,
    workerManifestRequests,
    workerRequests: workerManifestRequests + workerTicketRequests + r2PdfReads,
    workerTicketRequests,
  }
}

const freeMvp = modelPhase3(20)
const proLecture = modelPhase3(300)

assert.equal(freeMvp.existingLiveStateRequests, 21_600)
assert.equal(proLecture.existingLiveStateRequests, 324_000)
assert.equal(freeMvp.pdfBytesStoredInSupabase, 0)
assert.equal(proLecture.pdfBytesStoredInSupabase, 0)
assert.equal(proLecture.realtimeSubscriptionsAdded, 0)
assert.equal(proLecture.mainAppRedeploysPerPdf, 0)
assert.equal(proLecture.supabasePdfMetadataWrites, materialChanges)
assert.equal(proLecture.supabaseLiveStateWrites, 63)
assert.equal(proLecture.supabaseTokenInvocations, 900)
assert.equal(proLecture.retentionFeedInvocations, 4)
assert.equal(proLecture.workerRequests, 16_200)
assert.equal(
  proLecture.supabaseTokenInvocations / proLecture.existingLiveStateRequests <
    0.003,
  true,
)

console.log(
  JSON.stringify(
    {
      assumptions: {
        adminPageChanges,
        materialChanges,
        pdfRangeRequestsPerMaterial,
      },
      freeMvp,
      proLecture,
    },
    null,
    2,
  ),
)
console.log('Phase 3 20/300-student, 90-minute load model passed.')
