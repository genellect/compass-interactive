import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [
  env,
  flags,
  migration,
  context,
  archiveResume,
  liveRepository,
  lecturePage,
  commentInput,
  archivePage,
  archiveClient,
  demoRepository,
  displayView,
  app,
  css,
  worker,
  workerConfig,
  supabaseConfig,
  digest,
  archiveExporter,
  materialManager,
  archiveStorage,
  publisherClient,
  publisherServer,
  commentHistory,
  joinPage,
  syncedPdfViewer,
  learningSupport,
  managePolls,
  adminPage,
  adminRepository,
] = await Promise.all([
  read('.env.local.example'),
  read('src/lib/featureFlags.ts'),
  read(
    'supabase/migrations/20260716140920_phase6_6_ux_archive_metrics_digest.sql',
  ),
  read('src/context/CompassStateContext.tsx'),
  read('src/context/compass/useArchiveResume.ts'),
  read('src/repositories/supabaseLiveStateRepository.ts'),
  read('src/pages/LecturePage.tsx'),
  read('src/components/LiveBoard/CommentInput.tsx'),
  read('src/pages/LectureArchivePage.tsx'),
  read('src/archive/archiveClient.ts'),
  read('src/demo/demoRepository.ts'),
  read('src/components/DisplayView/DisplayView.tsx'),
  read('src/App.tsx'),
  read('src/App.css'),
  read('cloudflare/asset-worker/src/worker.ts'),
  read('cloudflare/asset-worker/wrangler.production.jsonc'),
  read('supabase/config.toml'),
  read('supabase/functions/send-daily-operations-digest/index.ts'),
  read('supabase/functions/export-lecture-archives/index.ts'),
  read('supabase/functions/manage-material-analysis/index.ts'),
  read('src/archive/archiveSessionStorage.ts'),
  read('src/pdf/publisherClient.ts'),
  read('publisher/src/server/publisherServer.ts'),
  read('src/pages/CommentHistoryPage.tsx'),
  read('src/pages/JoinPage.tsx'),
  read('src/components/DisplayView/SyncedPdfViewer.tsx'),
  read('src/components/LearningSupport/LearningSupport.tsx'),
  read('supabase/functions/manage-polls/index.ts'),
  read('src/pages/AdminPage.tsx'),
  read('src/repositories/supabaseAdminRepository.ts'),
])

assert.match(env, /^VITE_PHASE6_6_UX_INTEGRATION=false$/m)
assert.match(flags, /VITE_PHASE6_6_UX_INTEGRATION === 'true'/)
assert.doesNotMatch(env, /^VITE_(?:OPENAI|RESEND|SUPABASE_SERVICE_ROLE)/m)

assert.match(migration, /add column participant_count bigint/)
assert.match(migration, /add column visible_comment_count bigint/)
assert.match(
  migration,
  /create function public\.get_lecture_public_snapshot_v5/,
)
assert.match(migration, /create function public\.join_lecture_by_code_v2/)
assert.match(migration, /create function public\.admin_duplicate_lecture_v1/)
assert.match(migration, /polls_one_open_per_lecture_uidx/)
assert.match(migration, /create table public\.lecture_archive_exports/)
assert.match(migration, /create table public\.daily_operations_digest_jobs/)
assert.match(migration, /lecture_participant_presence_active_idx/)
assert.match(migration, /interval '45 seconds'/)
assert.match(migration, /interval '90 seconds'/)
assert.match(migration, /interval '15 seconds'/)
assert.match(migration, /participant_count_mode', 'active_90s'/)
assert.match(
  migration,
  /create function public\.admin_set_material_summary_publication/,
)
assert.match(migration, /'\{changed,material_summary\}'/)
assert.match(migration, /'material_summary'/)
assert.match(
  migration,
  /grant execute on function public\.admin_set_material_summary_publication\([\s\S]*?\) to service_role;/,
)
assert.doesNotMatch(
  migration,
  /grant execute on function public\.admin_set_material_summary_publication\([^;]*?\)\s+to (?:anon|authenticated);/,
)
assert.match(migration, /enable row level security/g)
assert.doesNotMatch(migration, /alter publication|supabase_realtime/i)

assert.match(liveRepository, /get_lecture_public_snapshot_v5/)
assert.match(
  liveRepository,
  /comment_limit: isPhase66UxIntegrationEnabled \? 5 : 100/,
)
assert.match(liveRepository, /known_metrics_version/)
assert.match(liveRepository, /participantCountMode: 'active_90s'/)
assert.match(liveRepository, /materialSummary/)
assert.match(context, /setParticipantCount\(/)
assert.match(context, /setVisibleCommentCount\(/)
assert.match(context, /persistLectureArchiveResumeCode\(lectureCode\)/)
assert.match(archiveResume, /attemptedCodeRef\.current = null/)
assert.match(archiveResume, /const retryArchiveResume = useCallback/)
assert.match(
  archiveResume,
  /setArchiveResumeNonce\(\(current\) => current \+ 1\)/,
)
assert.doesNotMatch(
  context,
  /const isLiveSyncRoute = \[[\s\S]*?'\/lecture\/comments'/,
)

assert.doesNotMatch(lecturePage, /participants\.length/)
assert.match(lecturePage, /participantCount/)
assert.match(lecturePage, /`約\$\{displayedParticipantCount\}`/)
assert.match(lecturePage, /lastSuccessfulSyncAt/)
assert.match(lecturePage, /講義から退出する/)
assert.match(lecturePage, /コメント履歴を見る/)
assert.match(lecturePage, /CAPTION_FRESHNESS_MS/)
assert.doesNotMatch(
  lecturePage,
  /気づいたことを残すたび、みんなの学びが少しずつ動き出します/,
)
assert.match(lecturePage, /const isLectureClosed =/)
assert.match(
  lecturePage,
  /onToggleLike=\{isLectureClosed \? undefined : toggleCommentLike\}/,
)
assert.match(lecturePage, /viewMode=\{isLectureClosed \? 'closed' : 'live'\}/)

assert.match(joinPage, /STANDARD_LECTURE_CODE_PATTERN = \/\^\[0-9\]\{6\}\$\//)
assert.match(
  joinPage,
  /LEGACY_LECTURE_CODE_PATTERN = \/\^\[A-Z0-9-\]\{4,32\}\$\//,
)
assert.match(joinPage, /getLectureCodeValidationError/)
assert.match(joinPage, /if \(validationError\) \{[\s\S]*?return/)

const mobileOrder = [
  'lecture-area-material',
  'lecture-area-caption',
  'lecture-area-voices',
  'lecture-area-composer',
  'lecture-area-poll',
  'lecture-area-recap',
  'lecture-area-summary',
  'lecture-area-exit',
]
let previousPosition = -1
for (const marker of mobileOrder) {
  const position = lecturePage.indexOf(marker)
  assert.ok(
    position > previousPosition,
    `${marker} must follow mobile DOM order`,
  )
  previousPosition = position
}

assert.match(commentInput, /10文字以内で入力してください/)
assert.match(commentInput, /sessionStorage/)
assert.match(commentInput, /nicknameMode === 'demo'/)
assert.doesNotMatch(commentInput, /デフォルト：匿名の参加者/)
assert.doesNotMatch(commentInput, /もう一度説明してほしい|この視点がおもしろい/)

assert.match(app, /path="\/lecture\/comments"/)
assert.match(app, /path="\/lecture\/archive"/)
assert.match(app, /const appTheme = 'theme-light'/)
assert.match(displayView, /comments\.slice\(0, 5\)/)
assert.match(
  css,
  /display-layout:fullscreen \.display-poll-rail[\s\S]*display: grid/,
)
assert.match(css, /\.theme-light \.display-shell/)
assert.match(css, /\.student-pdf-panel \.pdf-stage[\s\S]*?order: 0/)

assert.doesNotMatch(archiveClient, /supabase|ensureAnonymousAuthSession/i)
assert.match(archiveClient, /shouldRefreshArchiveAccess/)
assert.match(archiveClient, /getLectureJoinCaptchaToken/)
assert.match(archiveClient, /result\.response\.status === 401/)
assert.doesNotMatch(archivePage, /supabase|ensureAnonymousAuthSession/i)
assert.match(archivePage, /archiveSession\.materialSummary/)
assert.match(archivePage, /archiveResumeError/)
assert.match(archivePage, /retryArchiveResume/)
assert.match(archivePage, /もう一度読み込む/)
assert.match(archivePage, /約\{archiveSession\.participantCountApproximate\}/)
assert.match(archiveStorage, /window\.sessionStorage/)
assert.match(archiveStorage, /ARCHIVE_RESUME_CODE_STORAGE_KEY/)
assert.doesNotMatch(archiveStorage, /archiveAccessToken|comments|pdf/i)
assert.doesNotMatch(commentHistory, /onToggleLike=/)
assert.match(commentHistory, /void refreshComments\(\)/)
assert.doesNotMatch(commentHistory, /useAdaptiveLiveSync|setInterval/)
assert.match(archivePage, /viewMode="archive"/)
assert.match(syncedPdfViewer, /viewMode\?: 'archive' \| 'closed' \| 'live'/)
assert.match(syncedPdfViewer, /!presenterLocked && isLiveView/)
assert.match(learningSupport, /viewMode === 'live'/)
assert.match(learningSupport, /viewMode === 'archive'/)
assert.match(managePolls, /hasLegacyAdminFields\(body\)/)
assert.match(managePolls, /verifyGoogleAdminOperationRequest/)
assert.match(managePolls, /manage_google_admin_polls_v1/)
assert.match(managePolls, /target_include_history: body\.includeHistory \?\? false/)
assert.match(managePolls, /typeof result\.hasMore !== 'boolean'/)
assert.match(adminRepository, /Promise<AdminPollList>/)
assert.match(adminPage, /adminPollsHasMore/)
assert.match(
  adminPage,
  /const displayUpdated = await updateDisplayState\('setDocument'/,
)
assert.match(adminPage, /if \(!displayUpdated\)/)
assert.doesNotMatch(
  demoRepository,
  /supabase\s*\.\s*from\(|fetch\(|\.rpc\(|createClient|ensureAnonymousAuthSession/i,
)
assert.match(worker, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/)
assert.match(worker, /result\.action === 'archive-lookup'/)
assert.match(worker, /ARCHIVE_RATE_LIMITER/)
assert.match(worker, /ARCHIVE_CODE_LOOKUP_SECRET/)
assert.match(workerConfig, /ARCHIVE_RATE_LIMITER/)
assert.match(materialManager, /get_google_admin_material_analysis_v1/)
assert.match(materialManager, /manage_google_admin_material_analysis_v1/)
assert.match(materialManager, /target_transport_enabled: googleContext\.transportEnabled/)
assert.match(publisherClient, /verifySession/)
assert.match(publisherServer, /url\.pathname === '\/v1\/session'/)

assert.match(
  supabaseConfig,
  /\[functions\.export-lecture-archives\]\s+verify_jwt = false/,
)
assert.match(
  supabaseConfig,
  /\[functions\.send-daily-operations-digest\]\s+verify_jwt = false/,
)
for (const edgeSource of [digest, archiveExporter]) {
  assert.match(edgeSource, /TRIGGER_SECRET/)
  assert.doesNotMatch(edgeSource, /VITE_/)
}
assert.doesNotMatch(digest, /OPENAI_API_KEY|api\.openai\.com|\/v1\/responses/)

console.log('Phase 6.6 static UX, load-boundary, and security checks passed.')
