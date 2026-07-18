export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.')
    this.name = 'RequestBodyTooLargeError'
  }
}

export class UnsupportedJsonContentTypeError extends Error {
  constructor() {
    super('Request body must use application/json.')
    this.name = 'UnsupportedJsonContentTypeError'
  }
}

export const describeJsonBodyError = (error: unknown) => {
  if (error instanceof RequestBodyTooLargeError) {
    return { message: 'Request body is too large.', status: 413 }
  }
  if (error instanceof UnsupportedJsonContentTypeError) {
    return { message: 'Request must use application/json.', status: 415 }
  }
  return { message: 'Invalid JSON body.', status: 400 }
}

export const readJsonBody = async <T>(
  request: Request,
  maxBytes: number,
): Promise<T> => {
  const mediaType =
    request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase() ?? ''
  if (mediaType !== 'application/json') {
    throw new UnsupportedJsonContentTypeError()
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > maxBytes
  ) {
    throw new RequestBodyTooLargeError()
  }

  const reader = request.body?.getReader()
  if (!reader) {
    throw new SyntaxError('Request body is empty.')
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new RequestBodyTooLargeError()
    }
    chunks.push(value)
  }

  const bodyBytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return JSON.parse(new TextDecoder().decode(bodyBytes)) as T
}
