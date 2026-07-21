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
  selectedRunKind: 'production' | 'rehearsal' | null
}

export function AdminJournalClubPreset({
  adminToken,
  isLoading,
  lectures,
  onLoadingChange,
  onPrepared,
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
        `${runKind === 'production' ? '本番' : 'リハーサル'}を準備しました。修正版PDFを選択して公開し、開始する投票を確認してください。`,
      )
    } catch (error) {
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
      className="panel journal-club-preset"
      aria-labelledby="journal-club-preset-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">JOURNAL CLUB PRESET</p>
          <h2 id="journal-club-preset-title">7/23 Journal Club</h2>
        </div>
        {selectedRunKind ? (
          <span className={`journal-club-run-badge ${selectedRunKind}`}>
            {selectedRunKind === 'production' ? '本番' : 'リハーサル'}を選択中
          </span>
        ) : null}
      </div>
      <p className="note">
        修正版資料と6件の投票を同じ構成で準備します。作成後も講義と投票は開始されません。
      </p>
      <div className="button-row journal-club-preset-actions">
        <button
          className="secondary-button"
          disabled={isLoading}
          onClick={() => void prepare('rehearsal')}
          type="button"
        >
          リハーサルを準備
        </button>
        <button
          className="primary-button compact"
          disabled={isLoading || productionPrepared}
          onClick={() => void prepare('production')}
          type="button"
        >
          {productionPrepared ? '本番は準備済み' : '7/23 本番を準備'}
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
