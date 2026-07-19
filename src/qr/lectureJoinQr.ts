import QRCode from 'qrcode'

export const STANDARD_LECTURE_CODE_PATTERN = /^[0-9]{6}$/

export function normalizeStandardLectureCode(value: string) {
  const normalized = value.trim()
  return STANDARD_LECTURE_CODE_PATTERN.test(normalized) ? normalized : null
}

export function buildLectureJoinUrl(code: string, origin: string) {
  const normalizedCode = normalizeStandardLectureCode(code)
  if (!normalizedCode) {
    throw new Error('A six-digit lecture code is required for the join QR.')
  }

  const base = new URL(origin)
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new Error('The lecture join origin must use HTTP or HTTPS.')
  }

  const url = new URL('/join', base.origin)
  url.searchParams.set('code', normalizedCode)
  return url.toString()
}

export async function createLectureJoinQrSvg(code: string, origin: string) {
  const joinUrl = buildLectureJoinUrl(code, origin)
  const svg = await QRCode.toString(joinUrl, {
    color: { dark: '#10243eff', light: '#ffffffff' },
    errorCorrectionLevel: 'M',
    margin: 2,
    type: 'svg',
    width: 256,
  })
  return { joinUrl, svg }
}
