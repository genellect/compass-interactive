import { useEffect, useState, type FormEvent } from 'react'

type Props = {
  canNavigate: boolean
  currentPage: number
  displayPage: number | null
  displayStatus: string
  displayVersion: number | null
  isSending: boolean
  onGoToPage: (page: number) => void
  onNext: () => void
  onPrevious: () => void
  pageCount: number
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

export function LectureTransportBar({
  canNavigate,
  currentPage,
  displayPage,
  displayStatus,
  displayVersion,
  isSending,
  onGoToPage,
  onNext,
  onPrevious,
  pageCount,
}: Props) {
  const [pageInput, setPageInput] = useState(String(currentPage))

  useEffect(() => setPageInput(String(currentPage)), [currentPage])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!canNavigate || isEditableTarget(event.target)) return
      if (event.key === 'ArrowLeft' && currentPage > 1) {
        event.preventDefault()
        onPrevious()
      }
      if (event.key === 'ArrowRight' && currentPage < pageCount) {
        event.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canNavigate, currentPage, onNext, onPrevious, pageCount])

  function handleGoToPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const page = Number(pageInput)
    if (Number.isInteger(page) && page >= 1 && page <= pageCount) {
      onGoToPage(page)
    }
  }

  return (
    <section
      aria-label="講義資料のページ操作"
      className="admin-pdf-page-controller lecture-transport-bar"
    >
      <span className="lecture-transport-label">スライド</span>
      <span
        className={`support-state ${isSending ? '' : 'is-ready'}`}
        role="status"
      >
        {isSending ? '送信中…' : '送信済み'}
      </span>
      <span
        className={`support-state lecture-display-status ${
          displayStatus === '表示同期済み' ? 'is-ready' : ''
        }`}
        role="status"
      >
        {displayStatus}
        {displayVersion !== null ? ` · v${displayVersion}` : ''}
        {displayPage !== null ? ` · ${displayPage}ページ` : ''}
      </span>
      <button
        className="secondary-button"
        disabled={!canNavigate || currentPage <= 1}
        onClick={onPrevious}
        type="button"
      >
        ← 前へ
      </button>
      <strong aria-live="polite">
        {currentPage} / {pageCount}
      </strong>
      <button
        className="primary-button compact"
        disabled={!canNavigate || currentPage >= pageCount}
        onClick={onNext}
        type="button"
      >
        次へ →
      </button>
      <form className="admin-pdf-page-jump" onSubmit={handleGoToPage}>
        <label>
          <span>ページ</span>
          <input
            aria-label="表示するページ番号"
            disabled={!canNavigate}
            max={pageCount}
            min={1}
            onChange={(event) => setPageInput(event.target.value)}
            type="number"
            value={pageInput}
          />
        </label>
        <button
          className="secondary-button compact"
          disabled={!canNavigate}
          type="submit"
        >
          移動
        </button>
      </form>
      <span className="lecture-transport-shortcut">← → キーでも操作</span>
    </section>
  )
}
