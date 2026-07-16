import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { PAIRING_CODE_TTL_MS, PUBLISHER_SESSION_TTL_MS } from '../constants.ts'

function constantTimeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

export class PublisherSessionManager {
  readonly pairingCode: string
  readonly pairingExpiresAt: number
  private readonly now: () => number
  #pairingUsed = false
  #sessions = new Map<string, { expiresAt: number; origin: string }>()

  constructor(now: () => number = Date.now, pairingCode?: string) {
    this.now = now
    this.pairingCode =
      pairingCode ?? String(randomInt(0, 100_000_000)).padStart(8, '0')
    this.pairingExpiresAt = this.now() + PAIRING_CODE_TTL_MS
  }

  pair(code: string, origin: string) {
    if (
      this.#pairingUsed ||
      this.pairingExpiresAt <= this.now() ||
      !constantTimeEqual(code, this.pairingCode)
    ) {
      throw new Error('Pairing code is invalid or expired.')
    }
    this.#pairingUsed = true
    const token = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + PUBLISHER_SESSION_TTL_MS
    this.#sessions.set(token, { expiresAt, origin })
    return { expiresAt, token }
  }

  verify(token: string, origin: string) {
    for (const [candidate, session] of this.#sessions) {
      if (session.expiresAt <= this.now()) this.#sessions.delete(candidate)
    }
    const match = [...this.#sessions.entries()].find(
      ([candidate, session]) =>
        constantTimeEqual(candidate, token) && session.origin === origin,
    )
    return Boolean(match && match[1].expiresAt > this.now())
  }

  getExpiresAt(token: string, origin: string) {
    for (const [candidate, session] of this.#sessions) {
      if (session.expiresAt <= this.now()) this.#sessions.delete(candidate)
    }
    const match = [...this.#sessions.entries()].find(
      ([candidate, session]) =>
        constantTimeEqual(candidate, token) && session.origin === origin,
    )
    return match && match[1].expiresAt > this.now()
      ? match[1].expiresAt
      : null
  }
}
