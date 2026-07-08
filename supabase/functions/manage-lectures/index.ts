import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type LectureStatus = 'draft' | 'open' | 'closed'

type ManageLecturesRequest =
  | {
      action: 'list'
      adminToken?: string
    }
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
  id: string
  title: string
  status: LectureStatus
  starts_at: string | null
  ends_at: string | null
  created_at: string
  updated_at: string
}

type LectureCodeRow = {
  lecture_code: string
  lecture_session_id: string
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    status,
  })
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function base64UrlToString(value: string) {
  return textDecoder.decode(base64UrlToBytes(value))
}

function base64UrlEncode(value: Uint8Array) {
  let binary = ''

  for (const byte of value) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

async function signToken(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload))

  return base64UrlEncode(new Uint8Array(signature))
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false
  }

  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return mismatch === 0
}

async function verifyAdminToken(token: string, secret: string) {
  const [payload, signature] = token.split('.')

  if (!payload || !signature) {
    return false
  }

  const expectedSignature = await signToken(payload, secret)

  if (!timingSafeEqual(signature, expectedSignature)) {
    return false
  }

  const parsedPayload = JSON.parse(base64UrlToString(payload)) as {
    exp?: number
    scope?: string
  }

  if (parsedPayload.scope !== 'display-admin') {
    return false
  }

  return Boolean(parsedPayload.exp && parsedPayload.exp > Date.now() / 1000)
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(value.trim().toUpperCase()),
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

function normalizeTimestamp(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('日時の形式を確認してください。')
  }

  return date.toISOString()
}

function mapLecture(row: LectureRow, codeByLectureId: Map<string, string>) {
  return {
    createdAt: row.created_at,
    endsAt: row.ends_at,
    id: row.id,
    lectureCode: codeByLectureId.get(row.id) ?? '',
    startsAt: row.starts_at,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const adminPin = Deno.env.get('ADMIN_PIN')
  const tokenSecret = Deno.env.get('ADMIN_SESSION_SECRET') ?? adminPin

  if (!supabaseUrl || !serviceRoleKey || !tokenSecret) {
    return jsonResponse(
      { ok: false, message: 'Lecture management function is not configured.' },
      500,
    )
  }

  let body: ManageLecturesRequest
  try {
    body = (await request.json()) as ManageLecturesRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }

  if (!body.adminToken || !(await verifyAdminToken(body.adminToken, tokenSecret))) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  async function listLectures() {
    const { data: lectureRows, error: lectureError } = await supabase
      .from('lecture_sessions')
      .select('id,title,status,starts_at,ends_at,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(30)

    if (lectureError) {
      throw new Error(lectureError.message)
    }

    const lectureIds = ((lectureRows ?? []) as LectureRow[]).map((lecture) => lecture.id)
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

    return ((lectureRows ?? []) as LectureRow[]).map((lecture) =>
      mapLecture(lecture, codeByLectureId),
    )
  }

  try {
    if (body.action === 'list') {
      return jsonResponse({ lectures: await listLectures(), ok: true })
    }

    if (body.action === 'create') {
      const title = body.title?.trim()
      if (!title) {
        return jsonResponse({ ok: false, message: '講義タイトルを入力してください。' }, 400)
      }

      const startsAt = normalizeTimestamp(body.startsAt)
      const endsAt = normalizeTimestamp(body.endsAt)
      if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
        return jsonResponse(
          { ok: false, message: '終了時刻は開始時刻より後にしてください。' },
          400,
        )
      }

      let lectureCode = generateLectureCode()
      let codeHash = await sha256Hex(lectureCode)

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const { data: existingCode } = await supabase
          .from('lecture_admin_codes')
          .select('lecture_session_id')
          .eq('lecture_code', lectureCode)
          .maybeSingle()

        if (!existingCode) {
          break
        }

        lectureCode = generateLectureCode()
        codeHash = await sha256Hex(lectureCode)
      }

      const { data: lectureRow, error: lectureError } = await supabase
        .from('lecture_sessions')
        .insert({
          code_hash: codeHash,
          ends_at: endsAt,
          starts_at: startsAt,
          status: 'draft',
          title,
        })
        .select('id,title,status,starts_at,ends_at,created_at,updated_at')
        .single<LectureRow>()

      if (lectureError) {
        throw new Error(lectureError.message)
      }

      const { error: codeError } = await supabase.from('lecture_admin_codes').insert({
        lecture_code: lectureCode,
        lecture_session_id: lectureRow.id,
      })

      if (codeError) {
        throw new Error(codeError.message)
      }

      await supabase.from('lecture_display_state').upsert(
        {
          current_pdf_page: 1,
          display_mode: 'normal',
          lecture_session_id: lectureRow.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'lecture_session_id' },
      )

      const codeByLectureId = new Map([[lectureRow.id, lectureCode]])
      return jsonResponse({
        lecture: mapLecture(lectureRow, codeByLectureId),
        lectures: await listLectures(),
        ok: true,
      })
    }

    if (body.action === 'start' || body.action === 'close') {
      if (!body.lectureSessionId) {
        return jsonResponse({ ok: false, message: 'lectureSessionId is required.' }, 400)
      }

      const { data: currentLecture, error: currentLectureError } = await supabase
        .from('lecture_sessions')
        .select('id,status')
        .eq('id', body.lectureSessionId)
        .maybeSingle<{ id: string; status: LectureStatus }>()

      if (currentLectureError) {
        throw new Error(currentLectureError.message)
      }

      if (!currentLecture) {
        return jsonResponse({ ok: false, message: '講義が見つかりません。' }, 404)
      }

      if (body.action === 'start' && currentLecture.status !== 'draft') {
        return jsonResponse(
          { ok: false, message: '開始できるのは準備中の講義だけです。' },
          400,
        )
      }

      if (body.action === 'close' && currentLecture.status !== 'open') {
        return jsonResponse(
          { ok: false, message: '終了できるのは受付中の講義だけです。' },
          400,
        )
      }

      const nextStatus: LectureStatus = body.action === 'start' ? 'open' : 'closed'
      const patch =
        body.action === 'start'
          ? { starts_at: new Date().toISOString(), status: nextStatus }
          : { ends_at: new Date().toISOString(), status: nextStatus }

      const { error: updateError } = await supabase
        .from('lecture_sessions')
        .update(patch)
        .eq('id', body.lectureSessionId)

      if (updateError) {
        throw new Error(updateError.message)
      }

      return jsonResponse({ lectures: await listLectures(), ok: true })
    }

    return jsonResponse({ ok: false, message: 'Unknown action.' }, 400)
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Lecture operation failed.',
      },
      500,
    )
  }
})
