import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PUBLISHER_PORT,
  DOCUMENT_ID_PATTERN,
  LECTURE_PUBLIC_ID_PATTERN,
  MAX_PAIR_BODY_BYTES,
  MAX_PDF_BYTES,
  PUBLISHER_HOST,
} from '../constants.ts'
import type { PrivateObjectStore } from '../cloudflare/objectStore.ts'
import { ManifestConflictError, publishPdf } from '../publishPdf.ts'
import { verifyLectureAccessToken } from '../security/lectureToken.ts'
import { PublisherSessionManager } from '../security/publisherSession.ts'
import { LocalTextStore } from '../storage/localTextStore.ts'

type PublisherServerConfiguration = {
  allowedOrigins: Set<string>
  audience: string
  host: typeof PUBLISHER_HOST
  issuer: string
  port: number
  publicJwk: JsonWebKey
}

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
)

function isWithinDirectory(parent: string, candidate: string) {
  const relativePath = relative(parent, candidate)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function getPublisherApplicationDataRoot(environment: NodeJS.ProcessEnv) {
  const configuredApplicationData =
    environment.LOCALAPPDATA?.trim() || environment.XDG_DATA_HOME?.trim()
  const applicationDataRoot =
    configuredApplicationData && isAbsolute(configuredApplicationData)
      ? resolve(configuredApplicationData)
      : resolve(homedir(), '.local', 'share')
  const publisherRoot = resolve(
    applicationDataRoot,
    'COMPASS Interactive',
    'Publisher',
  )
  if (isWithinDirectory(REPOSITORY_ROOT, publisherRoot)) {
    throw new Error('Publisher data root must be outside the repository.')
  }
  return publisherRoot
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  origin?: string,
) {
  const bytes = Buffer.from(`${JSON.stringify(payload)}\n`)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': bytes.byteLength,
    'Content-Type': 'application/json; charset=utf-8',
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          Vary: 'Origin',
        }
      : {}),
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(bytes)
}

async function readBody(request: IncomingMessage, limit: number) {
  const contentLength = Number(request.headers['content-length'] ?? 0)
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > limit
  ) {
    throw Object.assign(new Error('Request body is too large.'), {
      status: 413,
    })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > limit) {
      request.destroy()
      throw Object.assign(new Error('Request body is too large.'), {
        status: 413,
      })
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

function getHeader(request: IncomingMessage, name: string) {
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function parseBoolean(value: string | null, defaultValue: boolean) {
  if (value === null) return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('Boolean query value is invalid.')
}

function getRequestContext(
  request: IncomingMessage,
  configuration: PublisherServerConfiguration,
) {
  const origin = getHeader(request, 'origin') ?? ''
  const expectedHost = `${configuration.host}:${configuration.port}`
  if (getHeader(request, 'host') !== expectedHost) {
    throw Object.assign(new Error('Host is not allowed.'), { status: 403 })
  }
  if (!configuration.allowedOrigins.has(origin)) {
    throw Object.assign(new Error('Origin is not allowed.'), { status: 403 })
  }
  return { origin }
}

export function createPublisherServer(dependencies: {
  configuration: PublisherServerConfiguration
  objectStore: PrivateObjectStore
  sessionManager?: PublisherSessionManager
  textStore: LocalTextStore
}) {
  const { configuration, objectStore, textStore } = dependencies
  const sessions = dependencies.sessionManager ?? new PublisherSessionManager()
  const server = createServer(async (request, response) => {
    let origin = ''
    try {
      ;({ origin } = getRequestContext(request, configuration))
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Headers':
            'Content-Type, X-Compass-Publisher-Token, X-Compass-Lecture-Token, X-File-Name',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        })
        response.end()
        return
      }

      const url = new URL(request.url ?? '/', `http://${configuration.host}`)
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        sendJson(
          response,
          200,
          { ok: true, service: 'compass-pdf-publisher', version: 1 },
          origin,
        )
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/pair') {
        if (
          getHeader(request, 'content-type')?.split(';', 1)[0] !==
          'application/json'
        ) {
          throw Object.assign(new Error('Pairing body must be JSON.'), {
            status: 415,
          })
        }
        const body = JSON.parse(
          (await readBody(request, MAX_PAIR_BODY_BYTES)).toString('utf8'),
        ) as { pairingCode?: string }
        const session = sessions.pair(body.pairingCode ?? '', origin)
        sendJson(
          response,
          200,
          {
            expiresAt: new Date(session.expiresAt).toISOString(),
            ok: true,
            sessionToken: session.token,
          },
          origin,
        )
        return
      }

      if (request.method === 'GET' && url.pathname === '/v1/session') {
        const expiresAt = sessions.getExpiresAt(
          getHeader(request, 'x-compass-publisher-token') ?? '',
          origin,
        )
        if (!expiresAt) {
          throw Object.assign(new Error('Publisher session is invalid.'), {
            status: 401,
          })
        }
        sendJson(
          response,
          200,
          {
            expiresAt: new Date(expiresAt).toISOString(),
            ok: true,
          },
          origin,
        )
        return
      }

      const publicationMatch = url.pathname.match(
        /^\/v1\/lectures\/(lecture_[a-z0-9]{16,64})\/documents\/([a-z0-9][a-z0-9-]{0,63})$/,
      )

      const extractionMatch = url.pathname.match(
        /^\/v1\/lectures\/(lecture_[a-z0-9]{16,64})\/documents\/([a-z0-9][a-z0-9-]{0,63})\/versions\/([0-9a-f]{64})\/extraction$/,
      )
      if (request.method === 'GET' && extractionMatch) {
        const lecturePublicId = extractionMatch[1]!
        const documentId = extractionMatch[2]!
        const documentVersion = extractionMatch[3]!
        const publisherToken =
          getHeader(request, 'x-compass-publisher-token') ?? ''
        if (!sessions.verify(publisherToken, origin)) {
          throw Object.assign(new Error('Publisher session is invalid.'), {
            status: 401,
          })
        }
        await verifyLectureAccessToken({
          audience: configuration.audience,
          issuer: configuration.issuer,
          lecturePublicId,
          publicJwk: configuration.publicJwk,
          token: getHeader(request, 'x-compass-lecture-token') ?? '',
        })
        const extraction = await textStore.load({
          documentId,
          documentVersion,
          lecturePublicId,
        })
        if (!extraction) {
          throw Object.assign(new Error('Local extraction was not found.'), {
            status: 404,
          })
        }
        sendJson(
          response,
          200,
          {
            extraction: {
              documentId: extraction.documentId,
              documentVersion: extraction.documentVersion,
              lecturePublicId: extraction.lecturePublicId,
              pageCount: extraction.pageCount,
              pages: extraction.pages,
              textAvailable:
                extraction.textAvailable ?? extraction.textCharCount > 0,
              textCharCount: extraction.textCharCount,
              textSha256: extraction.textSha256,
              textTruncated: extraction.textTruncated ?? false,
            },
            ok: true,
          },
          origin,
        )
        return
      }

      if (request.method === 'POST' && publicationMatch) {
        const lecturePublicId = publicationMatch[1]!
        const documentId = publicationMatch[2]!
        if (
          !LECTURE_PUBLIC_ID_PATTERN.test(lecturePublicId) ||
          !DOCUMENT_ID_PATTERN.test(documentId)
        ) {
          throw Object.assign(new Error('Publication path is invalid.'), {
            status: 400,
          })
        }
        const publisherToken =
          getHeader(request, 'x-compass-publisher-token') ?? ''
        if (!sessions.verify(publisherToken, origin)) {
          throw Object.assign(new Error('Publisher session is invalid.'), {
            status: 401,
          })
        }
        const lectureToken = getHeader(request, 'x-compass-lecture-token') ?? ''
        const claims = await verifyLectureAccessToken({
          audience: configuration.audience,
          issuer: configuration.issuer,
          lecturePublicId,
          publicJwk: configuration.publicJwk,
          token: lectureToken,
        })
        const contentType = getHeader(request, 'content-type') ?? ''
        if (contentType.split(';', 1)[0]?.trim() !== 'application/pdf') {
          throw Object.assign(new Error('Upload must be application/pdf.'), {
            status: 415,
          })
        }
        let fileName = ''
        try {
          fileName = decodeURIComponent(getHeader(request, 'x-file-name') ?? '')
        } catch {
          throw Object.assign(new Error('File name encoding is invalid.'), {
            status: 400,
          })
        }
        const displayName = url.searchParams.get('displayName') ?? ''
        const downloadEnabled = parseBoolean(
          url.searchParams.get('downloadEnabled'),
          true,
        )
        const result = await publishPdf(
          {
            accessExpiresAt: claims.access_until
              ? new Date(claims.access_until * 1000).toISOString()
              : null,
            accessVersion: claims.av,
            bytes: await readBody(request, MAX_PDF_BYTES),
            displayName,
            documentId,
            downloadEnabled,
            fileName,
            lecturePublicId,
            mimeType: contentType,
          },
          { objectStore, textStore },
        )
        sendJson(
          response,
          200,
          {
            accessVersion: result.accessVersion,
            document: {
              byteSize: result.document.byte_size,
              displayName: result.document.display_name,
              documentId: result.document.document_id,
              documentVersion: result.document.document_version,
              downloadEnabled: result.document.download_enabled,
              pageCount: result.document.page_count,
              pdfSha256: result.document.pdf_sha256,
              textCharCount: result.document.text_char_count,
              textSha256: result.document.text_sha256,
            },
            duplicate: result.duplicate,
            manifestEtag: result.manifestEtag,
            manifestVersion: result.manifestVersion,
            ok: true,
          },
          origin,
        )
        return
      }

      sendJson(response, 404, { message: 'Not found.', ok: false }, origin)
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? Number(error.status)
          : error instanceof ManifestConflictError
            ? 409
            : error instanceof SyntaxError
              ? 400
              : 422
      sendJson(
        response,
        Number.isInteger(status) ? status : 500,
        {
          message: error instanceof Error ? error.message : 'Publisher failed.',
          ok: false,
        },
        origin || undefined,
      )
    }
  })
  return { server, sessions }
}

export function loadPublisherServerConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): PublisherServerConfiguration {
  const port = Number(
    environment.COMPASS_PUBLISHER_PORT ?? DEFAULT_PUBLISHER_PORT,
  )
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('COMPASS_PUBLISHER_PORT is invalid.')
  }
  const allowedOrigins = new Set(
    (
      environment.COMPASS_PUBLISHER_ALLOWED_ORIGINS ??
      'http://127.0.0.1:5173,http://localhost:5173'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  let publicJwk: JsonWebKey
  try {
    publicJwk = JSON.parse(
      environment.COMPASS_PDF_ACCESS_PUBLIC_JWK ?? '',
    ) as JsonWebKey
  } catch {
    throw new Error('COMPASS_PDF_ACCESS_PUBLIC_JWK is not valid JSON.')
  }
  return {
    allowedOrigins,
    audience: environment.COMPASS_PDF_ACCESS_AUDIENCE ?? 'compass-pdf-worker',
    host: PUBLISHER_HOST,
    issuer: environment.COMPASS_PDF_ACCESS_ISSUER ?? 'compass-supabase',
    port,
    publicJwk,
  }
}

export function getDefaultPublisherDataRoot(environment = process.env) {
  const applicationDataRoot = getPublisherApplicationDataRoot(environment)
  const configuredRoot = environment.COMPASS_PUBLISHER_DATA_DIR?.trim()
  if (!configuredRoot) return applicationDataRoot

  const resolvedRoot = isAbsolute(configuredRoot)
    ? resolve(configuredRoot)
    : resolve(applicationDataRoot, configuredRoot)
  if (
    (!isAbsolute(configuredRoot) &&
      !isWithinDirectory(applicationDataRoot, resolvedRoot)) ||
    isWithinDirectory(REPOSITORY_ROOT, resolvedRoot)
  ) {
    throw new Error('Publisher data root must be outside the repository.')
  }
  return resolvedRoot
}
