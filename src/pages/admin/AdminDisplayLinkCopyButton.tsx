type AdminDisplayLinkCopyButtonProps = {
  isCopying: boolean
  isOpening: boolean
  lectureIsOpen: boolean
  onCopy: () => void
}

export function AdminDisplayLinkCopyButton({
  isCopying,
  isOpening,
  lectureIsOpen,
  onCopy,
}: AdminDisplayLinkCopyButtonProps) {
  return (
    <button
      className="secondary-button"
      disabled={isCopying || isOpening || !lectureIsOpen}
      onClick={onCopy}
      type="button"
    >
      {isCopying ? '準備中…' : 'URLをコピー'}
    </button>
  )
}
