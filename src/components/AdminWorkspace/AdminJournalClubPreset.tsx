import { useState } from 'react'
import {
  type AdminLecture,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'

type AdminJournalClubPresetProps = {
  adminToken: string
  isLoading: boolean
  lectures: AdminLecture[]
  onLoadingChange: (isLoading: boolean) => void
  onPrepared: (lecture: AdminLecture, lectures: AdminLecture[]) => void
  onSessionExpired: () => void
  selectedRunKind: 'production' | 'rehearsal' | null
}

export function AdminJournalClubPreset({
  adminToken,
  isLoading,
  lectures,
  onLoadingChange,
  onPrepared,
  onSessionExpired,
  selectedRunKind,
}: AdminJournalClubPresetProps) {
  const [message, setMessage] = useState('')
  const [requestIds, setRequestIds] = useState<
    Partial<Record<'production' | 'rehearsal', string>>
  >({})
  const productionPrepared = lectures.some(
    (lecture) => lecture.journalClub?.runKind === 'production',
  )

  async function prepare(runKind: 'production' | 'rehearsal') {
    if (!adminToken) {
      setMessage('管理者認証の有効期限が切れました。再度ログインしてください。')
      return
    }
    if (
      runKind === 'production' &&
      !window.confirm(
        '7/23 本番を準備します。講義と投票はまだ開始されません。続けますか？',
      )
    ) {
      return
    }

    const clientRequestId = requestIds[runKind] ?? crypto.randomUUID()
    if (!requestIds[runKind]) {
      setRequestIds((current) => ({ ...current, [runKind]: clientRequestId }))
    }
    onLoadingChange(true)
    setMessage(
      `${runKind === 'production' ? '本番' : 'リハーサル'}用の講義と6件の投票を準備しています…`,
    )

    try {
      const result = await supabaseAdminRepository.createJournalClubRun({
        adminToken,
        clientRequestId,
        runKind,
      })
      const preparedLecture = result.lectures.find(
        (lecture) => lecture.id === result.lectureSessionId,
      )
      if (!preparedLecture) {
        throw new Error('作成した講義を一覧から確認できませんでした。')
      }
      onPrepared(preparedLecture, result.lectures)
      setRequestIds((current) => {
        const next = { ...current }
        delete next[runKind]
        return next
      })
      setMessage(
        `${runKind === 'production' ? '本番' : 'リハーサル'}を講義一覧に追加しました。資料公開後、一覧の「開始」を押してください。`,
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Invalid Admin session.'
      ) {
        onSessionExpired()
        return
      }
      setMessage(
        error instanceof Error
          ? `準備を完了できませんでした: ${error.message}`
          : '準備を完了できませんでした。',
      )
    } finally {
      onLoadingChange(false)
    }
  }

  return (
    <section
      className="journal-club-preset"
      aria-labelledby="journal-club-preset-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">7/23 JOURNAL CLUB</p>
          <h3 id="journal-club-preset-title">
            Dual-targeting CasRx for C9orf72 ALS/FTD
          </h3>
        </div>
        {selectedRunKind ? (
          <span className={`journal-club-run-badge ${selectedRunKind}`}>
            {selectedRunKind === 'production' ? '本番' : 'リハーサル'}を選択中
          </span>
        ) : null}
      </div>
      <p className="note">
        講義資料と6件の投票を、独立した講義として追加します。
      </p>
      <div className="button-row journal-club-preset-actions">
        <button
          className="secondary-button"
          disabled={isLoading}
          onClick={() => void prepare('rehearsal')}
          type="button"
        >
          リハーサルを一覧に追加
        </button>
        <button
          className="primary-button compact"
          disabled={isLoading || productionPrepared}
          onClick={() => void prepare('production')}
          type="button"
        >
          {productionPrepared ? '本番は準備済み' : '7/23 本番を一覧に追加'}
        </button>
      </div>
      {message ? (
        <p className="note journal-club-preset-status" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
