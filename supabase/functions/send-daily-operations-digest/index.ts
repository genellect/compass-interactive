import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { timingSafeEqual } from '../_shared/adminToken.ts'
import {
  buildDailyDigestContent,
  type DailyDigestLecture,
  type DailyDigestUsage,
  getJstDayBounds,
  sendDailyDigestWithResend,
} from '../_shared/dailyDigest.ts'

type DigestJob = {
  attempt_count: number
  digest_date: string
  id: string
  recipient: string
}

type LectureRow = {
  closed_at: string | null
  id: string
  started_at: string
  status: string
  title: string
}

type UsageRow = {
  actual_microusd: number | null
  feature: string
  id: string
  requested_at: string
  reserved_microusd: number
  status: string
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    status,
  })
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('Authorization') ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Digest failed.'
  return message.replaceAll(/[\r\n\t]+/g, ' ').slice(0, 500)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (Deno.env.get('DAILY_DIGEST_ENABLED') !== 'true') {
    return jsonResponse(
      { message: 'Daily operations digest is disabled.', ok: false },
      503,
    )
  }

  const triggerSecret = Deno.env.get('DAILY_DIGEST_TRIGGER_SECRET') ?? ''
  const suppliedSecret = bearerToken(request)
  if (
    new TextEncoder().encode(triggerSecret).byteLength < 32 ||
    !timingSafeEqual(triggerSecret, suppliedSecret)
  ) {
    return jsonResponse({ message: 'Unauthorized.', ok: false }, 401)
  }

  const recipient = Deno.env.get('DAILY_DIGEST_RECIPIENT')?.trim()
  const from = Deno.env.get('DAILY_DIGEST_FROM')?.trim()
  const replyTo = Deno.env.get('DAILY_DIGEST_REPLY_TO')?.trim()
  const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!recipient || !from || !resendApiKey || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Daily operations digest is not configured.', ok: false },
      503,
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { data: claimedData, error: claimError } = await supabase.rpc(
    'claim_daily_operations_digest_jobs',
    {
      job_limit: 1,
      target_recipient: recipient,
    },
  )
  if (claimError) {
    return jsonResponse(
      { message: 'Digest job could not be claimed.', ok: false },
      500,
    )
  }
  const jobs = (claimedData ?? []) as DigestJob[]
  const job = jobs[0]
  if (!job) {
    return jsonResponse({ claimed: false, ok: true })
  }
  if (job.recipient.trim().toLowerCase() !== recipient.toLowerCase()) {
    return jsonResponse(
      { message: 'Claimed digest recipient is invalid.', ok: false },
      500,
    )
  }

  const finishJob = async (
    status: 'failed' | 'sent' | 'skipped',
    providerMessageId: string | null,
    errorMessage: string | null,
  ) => {
    const { error } = await supabase.rpc('finish_daily_operations_digest_job', {
      target_error_message: errorMessage,
      target_job_id: job.id,
      target_provider_message_id: providerMessageId,
      target_status: status,
    })
    if (error) {
      throw new Error('Digest job finalization failed.')
    }
  }

  try {
    const bounds = getJstDayBounds(job.digest_date)
    const [
      { data: lectureData, error: lectureError },
      { data: usageData, error: usageError },
    ] = await Promise.all([
      supabase
        .from('lecture_sessions')
        .select('id,title,status,started_at,closed_at')
        .gte('started_at', bounds.startInclusive)
        .lt('started_at', bounds.endExclusive)
        .order('started_at', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('ai_usage_ledger')
        .select(
          'id,feature,status,reserved_microusd,actual_microusd,requested_at',
        )
        .gte('requested_at', bounds.startInclusive)
        .lt('requested_at', bounds.endExclusive)
        .order('requested_at', { ascending: true })
        .order('id', { ascending: true }),
    ])
    if (lectureError || usageError) {
      throw lectureError ?? usageError
    }

    const lectures = ((lectureData ?? []) as LectureRow[]).map(
      (row): DailyDigestLecture => ({
        closedAt: row.closed_at,
        id: row.id,
        startedAt: row.started_at,
        status: row.status,
        title: row.title,
      }),
    )
    const usages = ((usageData ?? []) as UsageRow[]).map(
      (row): DailyDigestUsage => ({
        actualMicrousd: row.actual_microusd,
        feature: row.feature,
        id: row.id,
        requestedAt: row.requested_at,
        reservedMicrousd: row.reserved_microusd,
        status: row.status,
      }),
    )
    const content = buildDailyDigestContent({
      digestDate: job.digest_date,
      lectures,
      usages,
    })
    if (!content) {
      await finishJob('skipped', null, null)
      return jsonResponse({
        attemptCount: job.attempt_count,
        claimed: true,
        digestDate: job.digest_date,
        ok: true,
        skipped: true,
      })
    }

    const sent = await sendDailyDigestWithResend({
      apiKey: resendApiKey,
      content,
      digestDate: job.digest_date,
      from,
      recipient,
      ...(replyTo ? { replyTo } : {}),
    })
    await finishJob('sent', sent.id, null)
    return jsonResponse({
      apiCallCount: content.apiCallCount,
      attemptCount: job.attempt_count,
      claimed: true,
      digestDate: job.digest_date,
      lectureCount: content.lectureCount,
      ok: true,
      sent: true,
    })
  } catch (error) {
    const message = safeErrorMessage(error)
    try {
      await finishJob('failed', null, message)
    } catch {
      return jsonResponse(
        { message: 'Digest failed and could not be finalized.', ok: false },
        500,
      )
    }
    return jsonResponse({ message: 'Digest delivery failed.', ok: false }, 502)
  }
})
