export const PUBLISHER_HOST = '127.0.0.1'
export const DEFAULT_PUBLISHER_PORT = 43123
export const MAX_PDF_BYTES = 15 * 1024 * 1024
export const MAX_PDF_PAGES = 75
export const MAX_PDF_TEXT_CHARACTERS = 20_000
export const MAX_PAIR_BODY_BYTES = 4 * 1024
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000
export const PUBLISHER_SESSION_TTL_MS = 30 * 60 * 1000
export const MANIFEST_SCHEMA_VERSION = 1

export const LECTURE_PUBLIC_ID_PATTERN = /^lecture_[a-z0-9]{16,64}$/
export const DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
export const SHA256_PATTERN = /^[0-9a-f]{64}$/

export function containsControlCharacters(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || codePoint === 127
  })
}
