import type { LectureArchiveSession } from '../types/archive'
import { getLectureJoinCaptchaToken } from '../lib/turnstile'

type RawArchiveResponse = {
  archive?: {
    archive_expires_at: string
    closed_at: string
    comments: Array<{
      body: string
      created_at: string
      id: string
      is_pinned: boolean
      like_count: number
      nickname: string | null
    }>
    comments_has_more: boolean
    material_summary: null | {
      analysis_id: string
      body: {
        lead: string
        points: Array<{
          detail?: string
          pageLabel: string
          title: string
        }>
        reflectionQuestion?: string
      }
      published_at: string
      review_state: 'admin_confirmed' | 'admin_revised'
    }
    participant_count_approximate: number
    pdf: null | {
      current_page: number
      display_name: string
      document_id: string
      document_version: string
      download_enabled: boolean
      lecture_public_id: string
      manifest_version: number
      page_count: number
    }
    polls: Array<{
      created_at: string
      id: string
      options: Array<{
        id: string
        label: string
        order: number
        response_count: number
      }>
      question: string
      type: 'multiple' | 'single'
    }>
    started_at: string | null
    summaries: Array<{
      comment_pulse: string[]
      id: string
      lecture_recap: string[]
      pinned: boolean
      published_at: string
      review_state: 'admin_confirmed' | 'admin_revised' | 'ai_unreviewed'
      revision_id: string
      window_end: string
      window_index: number
      window_start: string
    }>
    title: string
  }
  archiveAccessToken?: string
  archiveAccessTokenExpiresAt?: string
  lookupHash?: string
  message?: string
  ok?: boolean
}

const ARCHIVE_CLIENT_ID_KEY = 'compass-interactive-archive-client-id'

export class ArchiveLookupError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ArchiveLookupError'
    this.status = status
  }
}

function getWorkerBaseUrl() {
  return (import.meta.env.VITE_PDF_WORKER_BASE_URL ?? '')
    .trim()
    .replace(/\/$/, '')
}

function getArchiveClientId() {
  const existing = window.sessionStorage.getItem(ARCHIVE_CLIENT_ID_KEY)
  if (existing) return existing
  const created = crypto.randomUUID()
  window.sessionStorage.setItem(ARCHIVE_CLIENT_ID_KEY, created)
  return created
}

function mapArchive(
  body: RawArchiveResponse,
  lectureCode: string,
  workerBaseUrl: string,
  resumeToken?: string,
): LectureArchiveSession {
  if (
    !body.ok ||
    !body.archive ||
    !body.archiveAccessToken ||
    !body.archiveAccessTokenExpiresAt ||
    !body.lookupHash
  ) {
    throw new Error(body.message ?? '講義アーカイブを開けませんでした。')
  }
  const archive = body.archive
  return {
    archiveAccessToken: body.archiveAccessToken,
    archiveAccessTokenExpiresAt: body.archiveAccessTokenExpiresAt,
    archiveExpiresAt: archive.archive_expires_at,
    closedAt: archive.closed_at,
    comments: archive.comments.map((comment) => ({
      body: comment.body,
      createdAt: comment.created_at,
      id: comment.id,
      isPinned: comment.is_pinned,
      lectureId: 'archive',
      likeCount: Number(comment.like_count),
      likedByParticipantIds: [],
      nickname: comment.nickname,
      participantId: '',
      status: 'visible',
    })),
    commentsHasMore: archive.comments_has_more,
    lookupHash: body.lookupHash,
    materialSummary: archive.material_summary
      ? {
          analysisId: archive.material_summary.analysis_id,
          body: archive.material_summary.body,
          publishedAt: archive.material_summary.published_at,
          reviewState: archive.material_summary.review_state,
        }
      : null,
    lectureCode,
    ...(resumeToken ? { resumeToken } : {}),
    participantCountApproximate: Number(archive.participant_count_approximate),
    pdf: archive.pdf
      ? {
          currentPage: Number(archive.pdf.current_page),
          displayName: archive.pdf.display_name,
          documentId: archive.pdf.document_id,
          documentVersion: archive.pdf.document_version,
          downloadEnabled: archive.pdf.download_enabled,
          lecturePublicId: archive.pdf.lecture_public_id,
          manifestVersion: Number(archive.pdf.manifest_version),
          pageCount: Number(archive.pdf.page_count),
        }
      : null,
    polls: archive.polls.map((poll) => ({
      createdAt: poll.created_at,
      id: poll.id,
      options: poll.options.map((option) => ({
        id: option.id,
        label: option.label,
        order: Number(option.order),
        responseCount: Number(option.response_count),
      })),
      question: poll.question,
      type: poll.type,
    })),
    startedAt: archive.started_at,
    summaries: archive.summaries.map((summary) => ({
      commentPulse: summary.comment_pulse,
      id: summary.id,
      lectureRecap: summary.lecture_recap,
      pinned: summary.pinned,
      publishedAt: summary.published_at,
      reviewState: summary.review_state,
      revisionId: summary.revision_id,
      windowEnd: summary.window_end,
      windowIndex: Number(summary.window_index),
      windowStart: summary.window_start,
    })),
    title: archive.title,
    workerBaseUrl,
  }
}

function shouldRefreshArchiveAccess(archive: LectureArchiveSession) {
  const expiresAt = Date.parse(archive.archiveAccessTokenExpiresAt)
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000
}

async function requestDocumentAccessUrl(
  archive: LectureArchiveSession,
  mode: 'download' | 'inline',
) {
  if (!archive.pdf) {
    throw new Error('この講義には公開資料がありません。')
  }
  const response = await fetch(
    `${archive.workerBaseUrl}/v1/archives/${archive.lookupHash}/documents/${archive.pdf.documentId}/${archive.pdf.documentVersion}/access?mode=${mode}`,
    {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${archive.archiveAccessToken}`,
      },
    },
  )
  const body = (await response.json().catch(() => null)) as {
    message?: string
    url?: string
  } | null

  return { body, response }
}

export const archiveClient = {
  isConfigured() {
    return Boolean(getWorkerBaseUrl())
  },

  async resolveLectureCode(
    lectureCode: string,
    turnstileToken: string | undefined,
  ): Promise<LectureArchiveSession | null> {
    const workerBaseUrl = getWorkerBaseUrl()
    if (!workerBaseUrl) return null
    const normalizedLectureCode = lectureCode.trim().toUpperCase()

    const response = await fetch(`${workerBaseUrl}/v1/archives/resolve`, {
      body: JSON.stringify({
        lectureCode: normalizedLectureCode,
        turnstileToken: turnstileToken ?? '',
      }),
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Compass-Client-Id': getArchiveClientId(),
      },
      method: 'POST',
    })
    if (response.status === 404) return null
    const body = (await response
      .json()
      .catch(() => null)) as RawArchiveResponse | null
    if (!response.ok || !body) {
      throw new ArchiveLookupError(
        body?.message ?? '講義アーカイブの確認に失敗しました。',
        response.status,
      )
    }
    return mapArchive(body, normalizedLectureCode, workerBaseUrl)
  },

  async resumeLecture(
    resumeToken: string,
    lectureCode: string,
  ): Promise<LectureArchiveSession | null> {
    const workerBaseUrl = getWorkerBaseUrl()
    if (!workerBaseUrl) return null
    if (
      resumeToken.length < 80 ||
      resumeToken.length > 2_048 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(resumeToken)
    ) {
      return null
    }
    const response = await fetch(`${workerBaseUrl}/v1/archives/resume`, {
      body: JSON.stringify({ resumeToken }),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    if ([401, 403, 404, 410].includes(response.status)) return null
    const body = (await response
      .json()
      .catch(() => null)) as RawArchiveResponse | null
    if (!response.ok || !body) {
      throw new ArchiveLookupError(
        body?.message ?? 'Lecture archive resume failed.',
        response.status,
      )
    }
    return mapArchive(
      body,
      lectureCode.trim().toUpperCase(),
      workerBaseUrl,
      resumeToken,
    )
  },

  async getDocumentAccessUrl(
    archive: LectureArchiveSession,
    mode: 'download' | 'inline',
  ) {
    if (!archive.pdf) {
      throw new Error('この講義には公開資料がありません。')
    }
    if (mode === 'download' && !archive.pdf.downloadEnabled) {
      throw new Error('この資料はダウンロードできません。')
    }

    let activeArchive = archive
    if (shouldRefreshArchiveAccess(activeArchive)) {
      const refreshed = activeArchive.resumeToken
        ? await this.resumeLecture(
            activeArchive.resumeToken,
            activeArchive.lectureCode,
          )
        : await getLectureJoinCaptchaToken().then((turnstileToken) =>
            this.resolveLectureCode(activeArchive.lectureCode, turnstileToken),
          )
      if (!refreshed) {
        throw new Error('講義記録へのアクセスを更新できませんでした。')
      }
      activeArchive = refreshed
    }

    let result = await requestDocumentAccessUrl(activeArchive, mode)
    if (result.response.status === 401 && activeArchive === archive) {
      const refreshed = archive.resumeToken
        ? await this.resumeLecture(archive.resumeToken, archive.lectureCode)
        : await getLectureJoinCaptchaToken().then((turnstileToken) =>
            this.resolveLectureCode(archive.lectureCode, turnstileToken),
          )
      if (!refreshed) {
        throw new Error('講義記録へのアクセスを更新できませんでした。')
      }
      result = await requestDocumentAccessUrl(refreshed, mode)
    }

    if (!result.response.ok || !result.body?.url) {
      throw new Error(
        result.body?.message ?? 'アーカイブ資料を開けませんでした。',
      )
    }
    return result.body.url
  },
}
