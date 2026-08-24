import { AdminDisplayLinkCopyButton } from './AdminDisplayLinkCopyButton'

type SharedProps = {
  isPreparing: boolean
  lectureIsOpen: boolean
}

export function AdminDisplayLaunchButton({
  isPreparing,
  lectureIsOpen,
  onPrepare,
}: SharedProps & { onPrepare: () => void }) {
  if (!lectureIsOpen) return null
  return (
    <button
      className="secondary-button"
      disabled={isPreparing}
      onClick={onPrepare}
      type="button"
    >
      {isPreparing ? '共有画面を準備中…' : '画面共有を開始する'}
    </button>
  )
}

export function AdminDisplayLaunchInstructions({
  copied,
  error,
  instructionsVisible,
  isCopying,
  isPreparing,
  lectureIsOpen,
  onCopy,
  onReplace,
}: SharedProps & {
  copied: boolean
  error: string | null
  instructionsVisible: boolean
  isCopying: boolean
  onCopy: () => void
  onReplace: () => void
}) {
  return (
    <>
      {error ? <p className="error-note">{error}</p> : null}
      {instructionsVisible && lectureIsOpen ? (
        <section className="display-launch-instructions" aria-live="polite">
          <p>
            教員画面とは別のブラウザでDisplayを開き、ウィンドウを拡張画面へ移動してください。
          </p>
          <div>
            <AdminDisplayLinkCopyButton
              isCopying={isCopying}
              isOpening={isPreparing}
              lectureIsOpen={lectureIsOpen}
              onCopy={onCopy}
            />
            <button
              className="secondary-button compact"
              disabled={isPreparing || isCopying}
              onClick={onReplace}
              type="button"
            >
              新しいURLを発行
            </button>
          </div>
          {copied ? (
            <p className="note" role="status">
              コピーしました。ChromeまたはEdgeのアドレスバーに貼り付けて開いてください。
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
