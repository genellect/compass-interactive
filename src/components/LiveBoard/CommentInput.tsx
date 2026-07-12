import { useState } from 'react'
import { AppIcon } from '../AppIcon'

const MAX_COMMENT_LENGTH = 120
const promptSuggestions = [
  'ここがまだ分からない',
  'もう一度説明してほしい',
  'この視点がおもしろい',
]

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
    <section className="panel comment-composer" id="lecture-question">
      <div className="panel-heading">
        <div className="section-intro">
          <span className="section-icon">
            <AppIcon name="message" size={18} />
          </span>
          <div>
            <p className="eyebrow">SHARE YOUR THOUGHT</p>
            <h2>気づき・質問を共有する</h2>
          </div>
        </div>
        <span className="privacy-badge">名前は表示されません</span>
      </div>

      <div className="prompt-suggestions" aria-label="入力例">
        {promptSuggestions.map((suggestion) => (
          <button
            disabled={disabled || isSubmitting}
            key={suggestion}
            onClick={() => setBody(suggestion)}
            type="button"
          >
            + {suggestion}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="sr-only">質問や気づき</span>
        <textarea
          disabled={disabled}
          maxLength={MAX_COMMENT_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            disabled
              ? '講義に参加すると投稿できます。'
              : '感じたことを、そのまま言葉にしてみてください。'
          }
          value={body}
        />
      </label>

      <div className="composer-footer">
        <span className={remainingLength < 20 ? 'is-low' : ''}>
          あと {remainingLength}字
        </span>
        <button
          className="primary-button compact"
          disabled={disabled || isSubmitting || body.trim().length === 0}
          onClick={handleSubmit}
          type="button"
        >
          {isSubmitting ? '送信中…' : 'みんなに共有'}
          {!isSubmitting ? <AppIcon name="arrow-right" size={17} /> : null}
        </button>
      </div>
    </section>
  )
}
