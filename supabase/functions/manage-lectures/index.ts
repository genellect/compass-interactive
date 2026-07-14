import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse } from '../_shared/responses.ts'

type LectureStatus = 'draft' | 'open' | 'closed'

type ManageLecturesRequest =
  | { action: 'list'; adminToken?: string }
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

function mapLecture(row: LectureRow, codeByLectureId: Map<string, string>) {
  return {
    archiveExpiresAt: row.archive_expires_at,
    closedAt: row.closed_at,
    closeActorType: row.close_actor_type,
    closeReason: row.close_reason,
    createdAt: row.created_at,
    endsAt: row.ends_at,
    hardStopAt: row.hard_stop_at,
    id: row.id,
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
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const suffix = Array.from(bytes)
    .map((byte) => alphabet[byte % alphabet.length])
    .join('')

  return `JC-${suffix}`
}

Deno.serve(async (request) => {
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
    body = (await request.json()) as ManageLecturesRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
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

  if (
    !body.adminToken ||
    !(await verifyAdminToken(body.adminToken, tokenSecret))
  ) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  async function listLectures() {
    const { data: lectureRows, error: lectureError } = await supabase
      .from('lecture_sessions')
      .select(
        'id,title,status,starts_at,ends_at,hard_stop_at,closed_at,close_reason,close_actor_type,archive_expires_at,created_at,updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(30)

    if (lectureError) {
      throw new Error(lectureError.message)
    }

    const rows = (lectureRows ?? []) as LectureRow[]
    const lectureIds = rows.map((lecture) => lecture.id)
    const codeByLectureId = new Map<string, string>()

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
    }

    return rows.map((lecture) => mapLecture(lecture, codeByLectureId))
  }

  try {
    if (body.action === 'list') {
      return jsonResponse({ lectures: await listLectures(), ok: true })
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
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const lectureCode = generateLectureCode()
        const { error } = await supabase.rpc('admin_create_lecture', {
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

      return jsonResponse({ lectures: await listLectures(), ok: true })
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
