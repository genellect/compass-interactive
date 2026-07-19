import { useEffect, useState } from 'react'
import {
  createLectureJoinQrSvg,
  normalizeStandardLectureCode,
} from '../qr/lectureJoinQr'

type LectureJoinQrProps = {
  code: string
  compact?: boolean
  title?: string
}

export function LectureJoinQr({
  code,
  compact = false,
  title = '講義に参加',
}: LectureJoinQrProps) {
  const normalizedCode = normalizeStandardLectureCode(code)
  const [qr, setQr] = useState<{ joinUrl: string; svg: string } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setQr(null)
    setFailed(false)
    if (!normalizedCode) return

    void createLectureJoinQrSvg(normalizedCode, window.location.origin)
      .then((result) => {
        if (active) setQr(result)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
    }
  }, [normalizedCode])

  if (!normalizedCode) return null

  return (
    <section
      className={`lecture-join-qr ${compact ? 'is-compact' : ''}`}
      data-lecture-join-url={qr?.joinUrl ?? ''}
    >
      <div>
        <p className="eyebrow">SCAN TO JOIN</p>
        <strong>{title}</strong>
        <span className="lecture-join-code">{normalizedCode}</span>
      </div>
      {qr ? (
        <img
          alt={`講義コード${normalizedCode}の参加QRコード`}
          decoding="async"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`}
        />
      ) : failed ? (
        <p className="error-note" role="alert">
          QRコードを表示できませんでした。講義コードを入力してください。
        </p>
      ) : (
        <span className="lecture-join-qr-loading" aria-label="QRコードを準備中" />
      )}
    </section>
  )
}
