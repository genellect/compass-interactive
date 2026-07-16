export type DailyDigestLecture = {
  closedAt: string | null
  id: string
  startedAt: string
  status: string
  title: string
}

export type DailyDigestUsage = {
  actualMicrousd: number | null
  feature: string
  id: string
  requestedAt: string
  reservedMicrousd: number
  status: string
}

export type DailyDigestContent = {
  apiCallCount: number
  estimatedApiCallCount: number
  html: string
  lectureCount: number
  subject: string
  text: string
  totalCostMicrousd: number
}

export type ResendDigestInput = {
  apiKey: string
  content: DailyDigestContent
  digestDate: string
  fetchImpl?: typeof fetch
  from: string
  recipient: string
  replyTo?: string
}

export class DailyDigestError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'DailyDigestError'
  }
}

const DIGEST_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const JST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000

const featureLabels: Record<string, string> = {
  academic_answers: '学術質問の補足',
  captions: 'リアルタイム字幕',
  material_analysis: '講義資料の分析',
  poll_suggestions: '投票案の生成',
  summaries: '5分要約',
}

const lectureStatusLabels: Record<string, string> = {
  closed: '終了済',
  draft: '準備中',
  open: '実施中',
}

function requireNonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DailyDigestError(
      'invalid_digest_record',
      `${name} must be a non-negative safe integer.`,
    )
  }
  return value
}

function formatJapaneseDate(digestDate: string) {
  const [year, month, day] = digestDate.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

function formatMicrousd(microusd: number) {
  return `US$${(microusd / 1_000_000).toFixed(6)}`
}

function groupUsageByFeature(usages: DailyDigestUsage[]) {
  const counts = new Map<string, number>()
  for (const usage of usages) {
    counts.set(usage.feature, (counts.get(usage.feature) ?? 0) + 1)
  }
  return [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function getJstDayBounds(digestDate: string) {
  if (!DIGEST_DATE_PATTERN.test(digestDate)) {
    throw new DailyDigestError(
      'invalid_digest_date',
      'Digest date must use YYYY-MM-DD.',
    )
  }
  const [year, month, day] = digestDate.split('-').map(Number)
  const jstStartMilliseconds =
    Date.UTC(year, month - 1, day) - JST_OFFSET_MILLISECONDS
  const parsed = new Date(jstStartMilliseconds + JST_OFFSET_MILLISECONDS)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new DailyDigestError(
      'invalid_digest_date',
      'Digest date is not a real calendar date.',
    )
  }
  return {
    endExclusive: new Date(
      jstStartMilliseconds + 24 * 60 * 60 * 1000,
    ).toISOString(),
    startInclusive: new Date(jstStartMilliseconds).toISOString(),
  }
}

export async function stableRecipientHash(recipient: string) {
  const normalized = recipient.trim().toLowerCase()
  if (!normalized) {
    throw new DailyDigestError(
      'invalid_digest_recipient',
      'Digest recipient is required.',
    )
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

export function buildDailyDigestContent(input: {
  digestDate: string
  lectures: DailyDigestLecture[]
  usages: DailyDigestUsage[]
}): DailyDigestContent | null {
  getJstDayBounds(input.digestDate)
  if (input.lectures.length === 0 && input.usages.length === 0) {
    return null
  }

  let totalCostMicrousd = 0
  let estimatedApiCallCount = 0
  for (const usage of input.usages) {
    const reserved = requireNonNegativeInteger(
      usage.reservedMicrousd,
      'reservedMicrousd',
    )
    if (usage.actualMicrousd === null) {
      totalCostMicrousd += reserved
      estimatedApiCallCount += 1
    } else {
      totalCostMicrousd += requireNonNegativeInteger(
        usage.actualMicrousd,
        'actualMicrousd',
      )
    }
  }
  requireNonNegativeInteger(totalCostMicrousd, 'totalCostMicrousd')

  const displayDate = formatJapaneseDate(input.digestDate)
  const subject = `COMPASS Interactive 日次運用レポート（${input.digestDate}）`
  const lectureTextLines = input.lectures.map(
    (lecture) =>
      `- ${lecture.title}（${lectureStatusLabels[lecture.status] ?? lecture.status}）`,
  )
  const lectureHtmlLines = input.lectures.map(
    (lecture) =>
      `<li>${escapeHtml(lecture.title)}（${escapeHtml(
        lectureStatusLabels[lecture.status] ?? lecture.status,
      )}）</li>`,
  )
  const featureCounts = groupUsageByFeature(input.usages)
  const featureTextLines = featureCounts.map(
    ([feature, count]) => `- ${featureLabels[feature] ?? feature}: ${count}件`,
  )
  const featureHtmlLines = featureCounts.map(
    ([feature, count]) =>
      `<li>${escapeHtml(featureLabels[feature] ?? feature)}: ${count}件</li>`,
  )
  const costLabel =
    estimatedApiCallCount === 0
      ? 'API実績コスト'
      : estimatedApiCallCount === input.usages.length
        ? 'API概算コスト（全件予約額）'
        : 'APIコスト（実績＋未確定分の予約額）'
  const estimateNote =
    estimatedApiCallCount > 0
      ? `未確定 ${estimatedApiCallCount}件は予約上限額で計算しています。`
      : '全件、記録済みの実績額で計算しています。'

  const textSections = [
    'COMPASS Interactive 日次運用レポート',
    displayDate,
    '',
    `本日、以下の講義が開始されました（${input.lectures.length}件）`,
    ...(lectureTextLines.length > 0 ? lectureTextLines : ['- なし']),
    '',
    `本日、以下のAPI呼び出しが${input.usages.length}件行われました`,
    ...(featureTextLines.length > 0 ? featureTextLines : ['- なし']),
    `${costLabel}: ${formatMicrousd(totalCostMicrousd)}`,
    estimateNote,
    '',
    'このメールはCOMPASS Interactiveの運用記録から自動作成されました。',
  ]

  const html = [
    '<!doctype html><html lang="ja"><body>',
    '<main style="font-family:system-ui,-apple-system,sans-serif;line-height:1.65;color:#172033">',
    '<h1 style="font-size:20px">COMPASS Interactive 日次運用レポート</h1>',
    `<p>${escapeHtml(displayDate)}</p>`,
    `<h2 style="font-size:16px">本日、以下の講義が開始されました（${input.lectures.length}件）</h2>`,
    lectureHtmlLines.length > 0
      ? `<ul>${lectureHtmlLines.join('')}</ul>`
      : '<p>なし</p>',
    `<h2 style="font-size:16px">本日、以下のAPI呼び出しが${input.usages.length}件行われました</h2>`,
    featureHtmlLines.length > 0
      ? `<ul>${featureHtmlLines.join('')}</ul>`
      : '<p>なし</p>',
    `<p><strong>${escapeHtml(costLabel)}:</strong> ${escapeHtml(
      formatMicrousd(totalCostMicrousd),
    )}</p>`,
    `<p>${escapeHtml(estimateNote)}</p>`,
    '<hr><p style="font-size:12px;color:#627085">このメールはCOMPASS Interactiveの運用記録から自動作成されました。</p>',
    '</main></body></html>',
  ].join('')

  return {
    apiCallCount: input.usages.length,
    estimatedApiCallCount,
    html,
    lectureCount: input.lectures.length,
    subject,
    text: textSections.join('\n'),
    totalCostMicrousd,
  }
}

export async function sendDailyDigestWithResend(
  input: ResendDigestInput,
): Promise<{ id: string }> {
  const fetchImpl = input.fetchImpl ?? fetch
  const recipientHash = await stableRecipientHash(input.recipient)
  const response = await fetchImpl('https://api.resend.com/emails', {
    body: JSON.stringify({
      from: input.from,
      html: input.content.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      subject: input.content.subject,
      text: input.content.text,
      to: [input.recipient],
    }),
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `compass-daily/${input.digestDate}/${recipientHash}`,
    },
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    throw new DailyDigestError(
      `resend_http_${response.status}`,
      `Daily digest provider request failed (${response.status}).`,
    )
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new DailyDigestError(
      'resend_invalid_response',
      'Daily digest provider returned invalid JSON.',
    )
  }
  const id =
    payload && typeof payload === 'object' && 'id' in payload
      ? (payload as { id?: unknown }).id
      : null
  if (typeof id !== 'string' || id.length < 1 || id.length > 200) {
    throw new DailyDigestError(
      'resend_invalid_response',
      'Daily digest provider did not return a message id.',
    )
  }
  return { id }
}
