export const MAX_COMMENT_NICKNAME_LENGTH = 10

export function limitCommentNicknameInput(value: string) {
  return Array.from(value).slice(0, MAX_COMMENT_NICKNAME_LENGTH).join('')
}

export function normalizeCommentNickname(value?: string | null) {
  if (typeof value !== 'string') return null

  const normalized = value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return null
  return limitCommentNicknameInput(normalized)
}
