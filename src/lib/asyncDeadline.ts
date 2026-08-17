export class RequestDeadlineError extends Error {
  readonly operation: string
  readonly timeoutMs: number

  constructor(operation: string, timeoutMs: number) {
    super(
      `${operation}に時間がかかっています。通信状態を確認して、もう一度お試しください。`,
    )
    this.name = 'RequestDeadlineError'
    this.operation = operation
    this.timeoutMs = timeoutMs
  }
}

export function waitForPromiseWithDeadline<T>(
  request: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number.')
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeoutId)
      callback()
    }
    const timeoutId = globalThis.setTimeout(() => {
      finish(() => reject(new RequestDeadlineError(operation, timeoutMs)))
    }, timeoutMs)

    void request.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}
