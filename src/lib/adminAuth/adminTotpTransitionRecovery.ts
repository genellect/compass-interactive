import {
  AdminAiUnlockError,
  authorizeTotpFactorTransition,
  finalizeTotpFactorTransition,
  type TotpFactorAction,
} from './adminAiUnlockApi'

const DATABASE_NAME = 'compass-interactive-admin-totp-recovery-v1'
const DATABASE_VERSION = 2
const STORE_NAME = 'active-transition'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const RECOVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type AdminTotpTransitionRecovery = {
  action: TotpFactorAction
  expiresAt: string
  finalizeRequestId: string
  intentDigest: string
  mutationRequestId: string
  targetFactorId: string
  version: 2
}

type StoredRecovery = AdminTotpTransitionRecovery & {
  authSessionId: string
  authUserId: string
  id: string
  recoveryToken: string
}

export type AdminTotpTransitionRecoveryScope = {
  authSessionId: string
  authUserId: string
}

function recoveryId(scope: AdminTotpTransitionRecoveryScope) {
  return `${scope.authUserId}:${scope.authSessionId}`
}

function sameScope(
  recovery: StoredRecovery,
  scope: AdminTotpTransitionRecoveryScope,
) {
  return (
    recovery.authUserId === scope.authUserId &&
    recovery.authSessionId === scope.authSessionId &&
    recovery.id === recoveryId(scope)
  )
}

export function getAdminTotpTransitionRecoveryScope(
  authUserId: string,
  accessToken: string,
): AdminTotpTransitionRecoveryScope | null {
  if (!UUID_PATTERN.test(authUserId)) return null
  try {
    const encoded = accessToken.split('.')[1]
    if (!encoded) return null
    const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded)) as {
      session_id?: unknown
      sub?: unknown
    }
    if (
      payload.sub !== authUserId ||
      typeof payload.session_id !== 'string' ||
      !UUID_PATTERN.test(payload.session_id)
    ) {
      return null
    }
    return { authSessionId: payload.session_id, authUserId }
  } catch {
    return null
  }
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function isStoredRecovery(value: unknown): value is StoredRecovery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return Boolean(
    Object.keys(candidate).length === 11 &&
      candidate.version === 2 &&
      typeof candidate.authUserId === 'string' &&
      UUID_PATTERN.test(candidate.authUserId) &&
      typeof candidate.authSessionId === 'string' &&
      UUID_PATTERN.test(candidate.authSessionId) &&
      candidate.id === `${candidate.authUserId}:${candidate.authSessionId}` &&
      (candidate.action === 'totp_factor_add' ||
        candidate.action === 'totp_factor_remove') &&
      typeof candidate.expiresAt === 'string' &&
      Number.isFinite(Date.parse(candidate.expiresAt)) &&
      Date.parse(candidate.expiresAt) <= Date.now() + 30 * 60 * 1_000 + 5_000 &&
      typeof candidate.finalizeRequestId === 'string' &&
      UUID_PATTERN.test(candidate.finalizeRequestId) &&
      typeof candidate.intentDigest === 'string' &&
      SHA256_HEX_PATTERN.test(candidate.intentDigest) &&
      typeof candidate.mutationRequestId === 'string' &&
      UUID_PATTERN.test(candidate.mutationRequestId) &&
      typeof candidate.targetFactorId === 'string' &&
      UUID_PATTERN.test(candidate.targetFactorId) &&
      typeof candidate.recoveryToken === 'string' &&
      RECOVERY_TOKEN_PATTERN.test(candidate.recoveryToken),
  )
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      },
      { once: true },
    )
    request.addEventListener('success', () => resolve(request.result), {
      once: true,
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Recovery storage is unavailable.')),
      { once: true },
    )
  })
}

async function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true,
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Recovery storage failed.')),
      { once: true },
    )
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, mode)
    const result = await callback(transaction.objectStore(STORE_NAME))
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve(), { once: true })
      transaction.addEventListener(
        'abort',
        () => reject(transaction.error ?? new Error('Recovery storage aborted.')),
        { once: true },
      )
      transaction.addEventListener(
        'error',
        () => reject(transaction.error ?? new Error('Recovery storage failed.')),
        { once: true },
      )
    })
    return result
  } finally {
    database.close()
  }
}

function sameTransition(
  recovery: AdminTotpTransitionRecovery,
  input: {
    action: TotpFactorAction
    intentDigest: string
    mutationRequestId: string
    targetFactorId: string
  },
) {
  return (
    recovery.action === input.action &&
    recovery.intentDigest === input.intentDigest &&
    recovery.mutationRequestId === input.mutationRequestId &&
    recovery.targetFactorId === input.targetFactorId
  )
}

function toPublicRecovery(recovery: StoredRecovery) {
  return {
    action: recovery.action,
    expiresAt: recovery.expiresAt,
    finalizeRequestId: recovery.finalizeRequestId,
    intentDigest: recovery.intentDigest,
    mutationRequestId: recovery.mutationRequestId,
    targetFactorId: recovery.targetFactorId,
    version: recovery.version,
  } satisfies AdminTotpTransitionRecovery
}

function sameStoredRecovery(left: StoredRecovery, right: StoredRecovery) {
  return (
    left.recoveryToken === right.recoveryToken &&
    left.finalizeRequestId === right.finalizeRequestId &&
    sameTransition(left, right)
  )
}

async function restoreStoredRecovery(scope: AdminTotpTransitionRecoveryScope) {
  return withStore('readwrite', async (store) => {
    const id = recoveryId(scope)
    const value = await requestResult(store.get(id))
    if (
      !isStoredRecovery(value) ||
      !sameScope(value, scope) ||
      Date.parse(value.expiresAt) <= Date.now()
    ) {
      if (value !== undefined) await requestResult(store.delete(id))
      return null
    }
    return value
  })
}

async function compareAndDeleteStoredRecovery(expected: StoredRecovery) {
  return withStore('readwrite', async (store) => {
    const current = await requestResult(store.get(expected.id))
    if (!isStoredRecovery(current) || !sameStoredRecovery(current, expected)) {
      return false
    }
    await requestResult(store.delete(expected.id))
    return true
  })
}

async function compareAndUpdateStoredRecovery(
  expected: StoredRecovery,
  replacement: StoredRecovery,
) {
  return withStore('readwrite', async (store) => {
    const current = await requestResult(store.get(expected.id))
    if (!isStoredRecovery(current) || !sameStoredRecovery(current, expected)) {
      return false
    }
    await requestResult(store.put(replacement))
    return true
  })
}

// Expiry cleanup deliberately does not accept a caller-supplied transition.
// The record is re-read and deleted in one readwrite transaction only when the
// currently stored claim itself is expired, so a stale tab cannot clear a newer
// recovery claim that reused the public request tuple.
export async function purgeExpiredAdminTotpTransitionRecovery(
  scope: AdminTotpTransitionRecoveryScope,
) {
  return withStore('readwrite', async (store) => {
    const id = recoveryId(scope)
    const current = await requestResult(store.get(id))
    if (
      !isStoredRecovery(current) ||
      !sameScope(current, scope) ||
      Date.parse(current.expiresAt) > Date.now()
    ) {
      return false
    }
    await requestResult(store.delete(id))
    return true
  })
}

export async function restoreAdminTotpTransitionRecovery(
  scope: AdminTotpTransitionRecoveryScope,
) {
  const stored = await restoreStoredRecovery(scope)
  return stored ? toPublicRecovery(stored) : null
}

export async function hasAdminTotpTransitionRecovery(
  scope: AdminTotpTransitionRecoveryScope,
) {
  return (await restoreStoredRecovery(scope)) !== null
}

async function getOrCreateStoredRecovery(
  input: {
    action: TotpFactorAction
    intentDigest: string
    mutationRequestId: string
    recoveryExpiresAt: string
    targetFactorId: string
  },
  scope: AdminTotpTransitionRecoveryScope,
) {
  const expiresAt = Date.parse(input.recoveryExpiresAt)
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt > Date.now() + 30 * 60 * 1_000 + 5_000
  ) {
    throw new AdminAiUnlockError(
      'relogin_required',
      'Please sign in again before changing an Authenticator.',
    )
  }
  const candidate: StoredRecovery = {
    action: input.action,
    authSessionId: scope.authSessionId,
    authUserId: scope.authUserId,
    expiresAt: input.recoveryExpiresAt,
    finalizeRequestId: crypto.randomUUID(),
    id: recoveryId(scope),
    intentDigest: input.intentDigest,
    mutationRequestId: input.mutationRequestId,
    recoveryToken: bytesToBase64Url(
      crypto.getRandomValues(new Uint8Array(32)),
    ),
    targetFactorId: input.targetFactorId,
    version: 2,
  }
  return withStore('readwrite', async (store) => {
    const current = await requestResult(store.get(candidate.id))
    if (
      isStoredRecovery(current) &&
      Date.parse(current.expiresAt) > Date.now()
    ) {
      // An existing claim was intentionally persisted before the authorize
      // request. Even inside the final five-minute boundary it must reach the
      // DB: exact replay may recover a committed transition, while P7334 with
      // recoveryUnused proves that this token never became authority and can
      // be removed by the caller's token-private CAS.
      return sameTransition(current, input)
        ? { createdByThisCall: false, recovery: current }
        : null
    }
    if (expiresAt <= Date.now() + 5 * 60 * 1_000) {
      throw new AdminAiUnlockError(
        'relogin_required',
        'Please sign in again before changing an Authenticator.',
      )
    }
    if (current !== undefined) await requestResult(store.delete(candidate.id))
    await requestResult(store.add(candidate))
    return { createdByThisCall: true, recovery: candidate }
  })
}

export async function authorizeAndPersistTotpFactorTransition(
  scope: AdminTotpTransitionRecoveryScope,
  appSessionToken: string,
  input: {
    action: TotpFactorAction
    intentDigest: string
    mutationRequestId: string
    recoveryExpiresAt: string
    targetFactorId: string
  },
) {
  const claim = await getOrCreateStoredRecovery(input, scope)
  if (!claim) {
    throw new Error('Another Authenticator change is awaiting recovery.')
  }
  const recovery = claim.recovery

  // The readwrite transaction above atomically claims one action-specific
  // credential across tabs before the request. A lost success response must
  // remain recoverable after tab close.
  try {
    const result = await authorizeTotpFactorTransition(appSessionToken, {
      controlIntentDigest: input.intentDigest,
      factorAction: input.action,
      recoveryToken: recovery.recoveryToken,
      requestId: input.mutationRequestId,
      targetFactorId: input.targetFactorId,
    })
    const expiresAt =
      typeof result.expiresAt === 'string' ? result.expiresAt : recovery.expiresAt
    const confirmed = { ...recovery, expiresAt }
    if (!(await compareAndUpdateStoredRecovery(recovery, confirmed))) {
      throw new Error('Authenticator recovery ownership changed unexpectedly.')
    }
    return toPublicRecovery(confirmed)
  } catch (error) {
    if (
      error instanceof AdminAiUnlockError &&
      error.code === 'relogin_required' &&
      error.recoveryUnused
    ) {
      // P7334 carries this DB-authoritative bit only after the request lock and
      // exact-transition replay lookup prove that no authorized transition
      // owns this token. The token-private CAS protects a newer claim.
      await compareAndDeleteStoredRecovery(recovery)
    }
    throw error
  }
}

export async function finalizePersistedTotpFactorTransition(
  scope: AdminTotpTransitionRecoveryScope,
  recovery?: AdminTotpTransitionRecovery | null,
) {
  const stored = await restoreStoredRecovery(scope)
  if (!stored) return null
  if (recovery && !sameTransition(stored, recovery)) return null
  const result = await finalizeTotpFactorTransition({
    controlIntentDigest: stored.intentDigest,
    factorAction: stored.action,
    finalizeRequestId: stored.finalizeRequestId,
    recoveryToken: stored.recoveryToken,
    requestId: stored.mutationRequestId,
    targetFactorId: stored.targetFactorId,
  })
  await compareAndDeleteStoredRecovery(stored)
  return result
}
