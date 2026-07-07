import { useState } from 'react'

const MAX_COMMENT_LENGTH = 120

type CommentInputProps = {
  disabled?: boolean
  isSubmitting?: boolean
  onSubmit: (body: string) => boolean | Promise<boolean>
}

export function CommentInput({
  disabled = false,
  isSubmitting = false,
  onSubmit,
}: CommentInputProps) {
  const [body, setBody] = useState('')
  const remainingLength = MAX_COMMENT_LENGTH - body.length

  async function handleSubmit() {
    const trimmedBody = body.trim()
    if (!trimmedBody || disabled || isSubmitting) {
      return
    }

    const didSubmit = await onSubmit(trimmedBody)
    if (didSubmit) {
      setBody('')
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Comment</p>
          <h2>匿名コメントを投稿</h2>
        </div>
        <span className="metric">{remainingLength}字</span>
      </div>

      <label className="field">
        <span>コメント</span>
        <textarea
          disabled={disabled}
          maxLength={MAX_COMMENT_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            disabled
              ? '講義に参加すると投稿できます。'
              : '質問、気づき、議論したい点を書いてください。'
          }
          value={body}
        />
      </label>

      <button
        className="primary-button"
        disabled={disabled || isSubmitting || body.trim().length === 0}
        onClick={handleSubmit}
        type="button"
      >
        {isSubmitting ? '投稿中...' : '投稿する'}
      </button>
    </section>
  )
}
