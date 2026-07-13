const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim()
const turnstileScriptId = 'compass-turnstile-script'
const turnstileScriptUrl =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const scriptLoadTimeoutMs = 20_000
const challengeTimeoutMs = 120_000

type TurnstileWidgetId = string

type TurnstileOptions = {
  sitekey: string
  action: string
  appearance: 'interaction-only'
  theme: 'auto'
  callback: (token: string) => void
  'error-callback': () => boolean
  'expired-callback': () => void
  'timeout-callback': () => void
}

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: TurnstileOptions,
  ) => TurnstileWidgetId
  remove: (widgetId: TurnstileWidgetId) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let turnstileScriptRequest: Promise<TurnstileApi> | null = null
let turnstileChallengeRequest: Promise<string | undefined> | null = null

function resolveTurnstileApi() {
  if (!window.turnstile) {
    throw new Error('安全確認サービスを読み込めませんでした。')
  }

  return window.turnstile
}

function loadTurnstileScript() {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile)
  }

  if (turnstileScriptRequest) {
    return turnstileScriptRequest
  }

  turnstileScriptRequest = new Promise<TurnstileApi>((resolve, reject) => {
    const existingScript = document.getElementById(
      turnstileScriptId,
    ) as HTMLScriptElement | null
    const script = existingScript ?? document.createElement('script')
    let settled = false

    const removeListeners = () => {
      window.clearTimeout(loadTimeoutId)
      script.removeEventListener('load', handleLoad)
      script.removeEventListener('error', handleError)
    }
    const handleError = () => {
      if (settled) {
        return
      }
      settled = true
      removeListeners()
      if (!window.turnstile) {
        script.remove()
      }
      reject(new Error('安全確認サービスへの接続に失敗しました。'))
    }
    const handleLoad = () => {
      if (settled) {
        return
      }
      settled = true
      removeListeners()
      try {
        resolve(resolveTurnstileApi())
      } catch (error) {
        script.remove()
        reject(error)
      }
    }
    const loadTimeoutId = window.setTimeout(handleError, scriptLoadTimeoutMs)

    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })

    if (!existingScript) {
      script.id = turnstileScriptId
      script.src = turnstileScriptUrl
      script.async = true
      script.defer = true
      document.head.append(script)
    }
  }).catch((error) => {
    turnstileScriptRequest = null
    throw error
  })

  return turnstileScriptRequest
}

function createChallengeElements() {
  const layer = document.createElement('div')
  layer.className = 'turnstile-challenge-layer'
  layer.setAttribute('role', 'status')
  layer.setAttribute('aria-live', 'polite')

  const card = document.createElement('div')
  card.className = 'turnstile-challenge-card'

  const message = document.createElement('p')
  message.textContent = '講義へ安全に参加するため、接続を確認しています。'

  const widget = document.createElement('div')
  widget.className = 'turnstile-challenge-widget'

  card.append(message, widget)
  layer.append(card)
  document.body.append(layer)

  return { layer, widget }
}

async function createTurnstileToken() {
  if (!turnstileSiteKey) {
    return undefined
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('この環境では安全確認を開始できません。')
  }

  const turnstile = await loadTurnstileScript()
  const { layer, widget } = createChallengeElements()

  return await new Promise<string>((resolve, reject) => {
    let widgetId: TurnstileWidgetId | null = null
    let cleanupRequested = false
    let settled = false

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      layer.remove()
      if (widgetId) {
        turnstile.remove(widgetId)
      } else {
        cleanupRequested = true
      }
    }
    const complete = (token: string) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(token)
    }
    const fail = (message: string) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(new Error(message))
    }
    const timeoutId = window.setTimeout(() => {
      fail('安全確認が時間切れになりました。もう一度お試しください。')
    }, challengeTimeoutMs)

    try {
      widgetId = turnstile.render(widget, {
        sitekey: turnstileSiteKey,
        action: 'anonymous-sign-in',
        appearance: 'interaction-only',
        theme: 'auto',
        callback: complete,
        'error-callback': () => {
          fail('安全確認に失敗しました。もう一度お試しください。')
          return false
        },
        'expired-callback': () => {
          fail('安全確認の有効期限が切れました。もう一度お試しください。')
        },
        'timeout-callback': () => {
          fail('安全確認が時間切れになりました。もう一度お試しください。')
        },
      })
      if (cleanupRequested) {
        turnstile.remove(widgetId)
      }
    } catch {
      fail('安全確認を開始できませんでした。もう一度お試しください。')
    }
  })
}

export function getAnonymousSignInCaptchaToken() {
  if (!turnstileChallengeRequest) {
    turnstileChallengeRequest = createTurnstileToken().finally(() => {
      turnstileChallengeRequest = null
    })
  }

  return turnstileChallengeRequest
}
