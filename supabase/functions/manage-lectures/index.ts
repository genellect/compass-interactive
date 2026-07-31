import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import {
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import {
  runRealtimeProviderHangupSweep,
  type RealtimeProviderHangupJob,
} from '../_shared/realtimeProviderHangup.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type LectureStatus = 'draft' | 'open' | 'closed'

type ManageLecturesRequest =
  | { action: 'list'; adminToken?: string; includeHistory?: boolean }
  | {
      action: 'create'
      adminToken?: string
      endsAt?: string | null
      startsAt?: string | null
      title?: string
    }
  | {
      action: 'start' | 'close'
      adminToken?: string
      lectureSessionId?: string
    }
  | {
      action: 'duplicate'
      adminToken?: string
      lectureSessionId?: string
    }
  | {
      action: 'createJournalClubRun'
      adminToken?: string
      clientRequestId?: string
      runKind?: 'production' | 'rehearsal'
    }

type LectureRow = {
  archive_expires_at: string | null
  closed_at: string | null
  close_actor_type: string | null
  close_reason: string | null
  created_at: string
  ends_at: string | null
  hard_stop_at: string | null
  id: string
  starts_at: string | null
  status: LectureStatus
  title: string
  updated_at: string
}

type LectureCodeRow = {
  lecture_code: string
  lecture_session_id: string
}

type JournalClubRunRow = {
  expected_document_id: string
  expected_pdf_byte_size: number
  expected_pdf_page_count: number
  expected_pdf_sha256: string
  lecture_session_id: string
  preset_version: number
  run_kind: 'production' | 'rehearsal'
}

type JournalClubRun = {
  expectedDocumentId: string
  expectedPdfByteSize: number
  expectedPdfPageCount: number
  expectedPdfSha256: string
  presetVersion: number
  runKind: 'production' | 'rehearsal'
}

function normalizeTimestamp(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid lecture timestamp.')
  }

  return date.toISOString()
}

function mapLecture(
  row: LectureRow,
  codeByLectureId: Map<string, string>,
  journalClubByLectureId: Map<string, JournalClubRun>,
) {
  return {
    archiveExpiresAt: row.archive_expires_at,
    closedAt: row.closed_at,
    closeActorType: row.close_actor_type,
    closeReason: row.close_reason,
    createdAt: row.created_at,
    endsAt: row.ends_at,
    hardStopAt: row.hard_stop_at,
    id: row.id,
    journalClub: journalClubByLectureId.get(row.id) ?? null,
    lectureCode: codeByLectureId.get(row.id) ?? '',
    startsAt: row.starts_at,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value.trim().toUpperCase()),
  )

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function generateLectureCode() {
  const range = 1_000_000
  const maxAccepted = Math.floor(0x1_0000_0000 / range) * range
  const random = new Uint32Array(1)

  do {
    crypto.getRandomValues(random)
  } while (random[0] >= maxAccepted)

  return String(random[0] % range).padStart(6, '0')
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) {
    return corsResponse
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Lecture management is not configured.' },
      500,
    )
  }

  let body: ManageLecturesRequest
  try {
    body = await readJsonBody<ManageLecturesRequest>(request, 32 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }

  let tokenSecret: string
  try {
    tokenSecret = getAdminTokenSecret()
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Admin auth failed.',
      },
      500,
    )
  }

  const adminClaims = body.adminToken
    ? await getAdminTokenClaims(body.adminToken, tokenSecret, request)
    : null
  if (!adminClaims) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  async function sweepRealtimeProviderCalls(lectureSessionId: string) {
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
    if (!openAiApiKey) {
      return { claimed: 0, pending: true, retried: 0, stopped: 0 }
    }
    try {
      const result = await runRealtimeProviderHangupSweep({
        apiKey: openAiApiKey,
        claim: async ({ lectureSessionId, limit, operationId }) => {
          const { data, error } = await supabase.rpc(
            'claim_realtime_provider_hangups',
            {
              job_limit: limit,
              target_lecture_session_id: lectureSessionId,
              target_operation_id: operationId,
            },
          )
          if (error) throw new Error('realtime_hangup_claim_failed')
          return (data ?? []) as RealtimeProviderHangupJob[]
        },
        finish: async ({ error: providerError, operationId, succeeded }) => {
          const { data, error } = await supabase.rpc(
            'finish_realtime_provider_hangup',
            {
              target_error: providerError,
              target_operation_id: operationId,
              target_succeeded: succeeded,
            },
          )
          if (error) throw new Error('realtime_hangup_finalize_failed')
          return data === true
        },
        lectureSessionId,
        limit: 10,
      })
      return { ...result, pending: result.retried > 0 }
    } catch {
      return { claimed: 0, pending: true, retried: 1, stopped: 0 }
    }
  }

  async function listLectures(limit = 30) {
    const { data: lectureRows, error: lectureError } = await supabase
      .from('lecture_sessions')
      .select(
        'id,title,status,starts_at,ends_at,hard_stop_at,closed_at,close_reason,close_actor_type,archive_expires_at,created_at,updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(limit)

    if (lectureError) {
      throw new Error(lectureError.message)
    }

    const rows = (lectureRows ?? []) as LectureRow[]
    const lectureIds = rows.map((lecture) => lecture.id)
    const codeByLectureId = new Map<string, string>()
    const journalClubByLectureId = new Map<string, JournalClubRun>()

    if (lectureIds.length > 0) {
      const { data: codeRows, error: codeError } = await supabase
        .from('lecture_admin_codes')
        .select('lecture_session_id,lecture_code')
        .in('lecture_session_id', lectureIds)

      if (codeError) {
        throw new Error(codeError.message)
      }

      for (const codeRow of (codeRows ?? []) as LectureCodeRow[]) {
        codeByLectureId.set(codeRow.lecture_session_id, codeRow.lecture_code)
      }

      if (Deno.env.get('PHASE7_27_JOURNAL_CLUB_ENABLED') === 'true') {
        const { data: runRows, error: runError } = await supabase
          .from('phase727_journal_club_runs')
          .select(
            'lecture_session_id,run_kind,preset_version,expected_document_id,expected_pdf_sha256,expected_pdf_byte_size,expected_pdf_page_count',
          )
          .in('lecture_session_id', lectureIds)

        if (runError) {
          throw new Error(runError.message)
        }
        for (const run of (runRows ?? []) as JournalClubRunRow[]) {
          journalClubByLectureId.set(run.lecture_session_id, {
            expectedDocumentId: run.expected_document_id,
            expectedPdfByteSize: Number(run.expected_pdf_byte_size),
            expectedPdfPageCount: Number(run.expected_pdf_page_count),
            expectedPdfSha256: run.expected_pdf_sha256,
            presetVersion: Number(run.preset_version),
            runKind: run.run_kind,
          })
        }
      }
    }

    return rows.map((lecture) =>
      mapLecture(lecture, codeByLectureId, journalClubByLectureId),
    )
  }

  try {
    if (body.action === 'list') {
      return jsonResponse({
        lectures: await listLectures(body.includeHistory ? 30 : 3),
        ok: true,
      })
    }

    if (body.action === 'create') {
      const title = body.title?.trim()
      if (!title) {
        return jsonResponse(
          { ok: false, message: 'Lecture title is required.' },
          400,
        )
      }

      const startsAt = normalizeTimestamp(body.startsAt)
      const endsAt = normalizeTimestamp(body.endsAt)
      if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
        return jsonResponse(
          { ok: false, message: 'Lecture end must be after its start.' },
          400,
        )
      }

      let created = false
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const lectureCode = generateLectureCode()
        const { error } = await supabase.rpc('admin_create_lecture_v2', {
          lecture_code: lectureCode,
          lecture_code_hash: await sha256Hex(lectureCode),
          lecture_ends_at: endsAt,
          lecture_starts_at: startsAt,
          lecture_title: title,
        })

        if (!error) {
          created = true
          break
        }

        if (error.code !== '23505') {
          throw new Error(error.message)
        }
      }

      if (!created) {
        throw new Error('Could not generate a unique lecture code.')
      }

      return jsonResponse({ lectures: await listLectures(), ok: true })
    }

    if (body.action === 'createJournalClubRun') {
      if (Deno.env.get('PHASE7_27_JOURNAL_CLUB_ENABLED') !== 'true') {
        return jsonResponse(
          { ok: false, message: 'Journal Club preset is not enabled.' },
          409,
        )
      }
      if (
        Deno.env.get(
          'PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED',
        ) !== 'true'
      ) {
        return jsonResponse(
          { ok: false, message: 'Journal Club preset creation is retired.' },
          410,
        )
      }
      if (
        !adminClaims.sid ||
        !body.clientRequestId ||
        !UUID_PATTERN.test(body.clientRequestId) ||
        !['production', 'rehearsal'].includes(body.runKind ?? '')
      ) {
        return jsonResponse(
          { ok: false, message: 'Journal Club request is invalid.' },
          400,
        )
      }

      const bearerToken =
        request.headers
          .get('Authorization')
          ?.replace(/^Bearer\s+/i, '')
          .trim() ?? ''
      const { data: authData, error: authError } =
        await supabase.auth.getUser(bearerToken)
      if (authError || !authData.user) {
        return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
      }

      let createdResult: {
        idempotent_replay?: boolean
        lecture_session_id?: string
      } | null = null
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const lectureCode = generateLectureCode()
        const { data, error } = await supabase.rpc(
          'admin_create_phase727_journal_club_run_v1',
          {
            target_admin_auth_user_id: authData.user.id,
            target_admin_session_id: adminClaims.sid,
            target_client_request_id: body.clientRequestId,
            target_lecture_code: lectureCode,
            target_lecture_code_hash: await sha256Hex(lectureCode),
            target_run_kind: body.runKind,
          },
        )

        if (!error) {
          createdResult = data as typeof createdResult
          break
        }
        if (error.code === '23505') continue
        if (error.code === 'P0001') {
          return jsonResponse(
            { ok: false, message: 'The production run is already prepared.' },
            409,
          )
        }
        if (error.code === '42501') {
          return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
        }
        throw new Error(error.message)
      }

      if (!createdResult?.lecture_session_id) {
        throw new Error('Could not generate a unique lecture code.')
      }
      return jsonResponse({
        createdLectureSessionId: createdResult.lecture_session_id,
        idempotentReplay: createdResult.idempotent_replay === true,
        lectures: await listLectures(),
        ok: true,
      })
    }

    if (body.action === 'duplicate') {
      if (!body.lectureSessionId) {
        return jsonResponse(
          { ok: false, message: 'lectureSessionId is required.' },
          400,
        )
      }

      let duplicated = false
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const lectureCode = generateLectureCode()
        const { error } = await supabase.rpc('admin_duplicate_lecture_v1', {
          lecture_code: lectureCode,
          lecture_code_hash: await sha256Hex(lectureCode),
          source_lecture_session_id: body.lectureSessionId,
        })

        if (!error) {
          duplicated = true
          break
        }

        if (error.code === 'P0001') {
          return jsonResponse(
            {
              ok: false,
              message: 'Only a closed lecture can be reused.',
            },
            409,
          )
        }

        if (error.code !== '23505') {
          throw new Error(error.message)
        }
      }

      if (!duplicated) {
        throw new Error('Could not generate a unique lecture code.')
      }

      return jsonResponse({ lectures: await listLectures(), ok: true })
    }

    if (body.action === 'start' || body.action === 'close') {
      if (!body.lectureSessionId) {
        return jsonResponse(
          { ok: false, message: 'lectureSessionId is required.' },
          400,
        )
      }

      const { data: changed, error } = await supabase.rpc(
        'admin_set_lecture_status',
        {
          target_action: body.action,
          target_lecture_session_id: body.lectureSessionId,
        },
      )

      if (error) {
        throw new Error(error.message)
      }

      if (!changed) {
        return jsonResponse(
          { ok: false, message: 'Lecture status transition is not allowed.' },
          409,
        )
      }

      const providerHangup =
        body.action === 'close'
          ? await sweepRealtimeProviderCalls(body.lectureSessionId)
          : null
      return jsonResponse({
        lectures: await listLectures(),
        ok: true,
        providerHangup,
      })
    }

    return jsonResponse({ ok: false, message: 'Unknown action.' }, 400)
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Lecture operation failed.',
      },
      500,
    )
  }
})
