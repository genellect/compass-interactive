const DATABASE_NAME = 'compass-interactive-admin-ai-v1'
const DATABASE_VERSION = 1
const STORE_NAME = 'remembered-browser-credentials'

type RememberedBrowserCredentialBase = {
  createdAt: string
  credentialToken: string
  environmentId: string
  expiresAt: string
  id: string
  membershipId: string
  privateKey: CryptoKey
  principalId: string
  publicKeyFingerprint: string
  publicKeyJwk: JsonWebKey
}

export type PendingRememberedBrowserEnrollment =
  RememberedBrowserCredentialBase & {
    beginRequestId: string
    completionRequestId: string
    enrollmentExpiresAt: string
    enrollmentNonce: string
    status: 'pending'
  }

export type RememberedBrowserCredential = RememberedBrowserCredentialBase & {
  status: 'active'
}

type StoredRememberedBrowserCredential =
  | PendingRememberedBrowserEnrollment
  | RememberedBrowserCredential

export type RememberedBrowserIdentityScope = {
  environmentId: string
  membershipId: string
  principalId: string
}

function sameScope(
  credential: RememberedBrowserCredentialBase,
  scope: RememberedBrowserIdentityScope,
) {
  return (
    credential.environmentId === scope.environmentId &&
    credential.membershipId === scope.membershipId &&
    credential.principalId === scope.principalId
  )
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true,
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
      { once: true },
    )
  })
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
      () => reject(request.error ?? new Error('IndexedDB open failed.')),
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
        () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')),
        { once: true },
      )
      transaction.addEventListener(
        'error',
        () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
        { once: true },
      )
    })
    return result
  } finally {
    database.close()
  }
}

function samePendingEnrollment(
  left: PendingRememberedBrowserEnrollment,
  right: PendingRememberedBrowserEnrollment,
) {
  return (
    left.id === right.id &&
    left.beginRequestId === right.beginRequestId &&
    left.completionRequestId === right.completionRequestId &&
    left.enrollmentExpiresAt === right.enrollmentExpiresAt &&
    left.enrollmentNonce === right.enrollmentNonce &&
    left.credentialToken === right.credentialToken &&
    sameScope(left, right) &&
    left.publicKeyFingerprint === right.publicKeyFingerprint
  )
}

function sameCredentialProvenance(
  active: RememberedBrowserCredential,
  pending: PendingRememberedBrowserEnrollment,
) {
  return (
    active.id === pending.id &&
    active.createdAt === pending.createdAt &&
    active.credentialToken === pending.credentialToken &&
    sameScope(active, pending) &&
    active.publicKeyFingerprint === pending.publicKeyFingerprint &&
    active.publicKeyJwk.crv === pending.publicKeyJwk.crv &&
    active.publicKeyJwk.kty === pending.publicKeyJwk.kty &&
    active.publicKeyJwk.x === pending.publicKeyJwk.x &&
    active.publicKeyJwk.y === pending.publicKeyJwk.y
  )
}

export async function createPendingRememberedBrowserEnrollment(
  scope: RememberedBrowserIdentityScope,
  expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
) {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  if (keyPair.privateKey.extractable) {
    throw new Error('Remembered-browser private key must be non-extractable.')
  }
  const exported = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  if (
    exported.kty !== 'EC' ||
    exported.crv !== 'P-256' ||
    typeof exported.x !== 'string' ||
    typeof exported.y !== 'string'
  ) {
    throw new Error('Unexpected remembered-browser public key.')
  }
  const publicKeyJwk = {
    crv: 'P-256',
    kty: 'EC',
    x: exported.x,
    y: exported.y,
  } satisfies JsonWebKey
  const canonicalJwk = `{"crv":"P-256","kty":"EC","x":"${exported.x}","y":"${exported.y}"}`
  const publicKeyFingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonicalJwk),
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const credential: PendingRememberedBrowserEnrollment = {
    beginRequestId: crypto.randomUUID(),
    completionRequestId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    credentialToken: bytesToBase64Url(
      crypto.getRandomValues(new Uint8Array(32)),
    ),
    environmentId: scope.environmentId,
    expiresAt,
    // The server clamps its enrollment nonce to five minutes. A slightly
    // conservative local window remains safe when the begin response is lost.
    enrollmentExpiresAt: new Date(
      Date.now() + 4 * 60 * 1_000 + 55 * 1_000,
    ).toISOString(),
    enrollmentNonce: bytesToBase64Url(
      crypto.getRandomValues(new Uint8Array(32)),
    ),
    id: crypto.randomUUID(),
    membershipId: scope.membershipId,
    privateKey: keyPair.privateKey,
    principalId: scope.principalId,
    publicKeyFingerprint,
    publicKeyJwk,
    status: 'pending',
  }
  return withStore('readwrite', async (store) => {
    const values = (await requestResult(
      store.getAll(),
    )) as StoredRememberedBrowserCredential[]
    const existing = values.find(
      (value): value is PendingRememberedBrowserEnrollment =>
        value.status === 'pending' && sameScope(value, scope),
    )
    if (existing && Date.parse(existing.enrollmentExpiresAt) > Date.now()) {
      return existing
    }
    if (existing) await requestResult(store.delete(existing.id))
    await requestResult(store.add(credential))
    return credential
  })
}

export async function getRememberedBrowserCredential(
  id: string,
  scope: RememberedBrowserIdentityScope,
) {
  return withStore('readonly', async (store) => {
    const value = await requestResult(store.get(id))
    const credential = value as StoredRememberedBrowserCredential | undefined
    return credential?.status === 'active' && sameScope(credential, scope)
      ? credential
      : null
  })
}

export async function listRememberedBrowserCredentials(
  scope: RememberedBrowserIdentityScope,
) {
  return withStore('readwrite', async (store) => {
    const values = await requestResult(store.getAll())
    const credentials = values as StoredRememberedBrowserCredential[]
    for (const credential of credentials) {
      if (
        credential.status === 'active' &&
        sameScope(credential, scope) &&
        Date.parse(credential.expiresAt) <= Date.now()
      ) {
        await requestResult(store.delete(credential.id))
      }
    }
    return credentials.filter(
      (credential): credential is RememberedBrowserCredential =>
        credential.status === 'active' &&
        sameScope(credential, scope) &&
        Date.parse(credential.expiresAt) > Date.now(),
    )
  })
}

export async function getPendingRememberedBrowserEnrollment(
  scope: RememberedBrowserIdentityScope,
) {
  return withStore('readonly', async (store) => {
    const values = (await requestResult(
      store.getAll(),
    )) as StoredRememberedBrowserCredential[]
    return (
      values.find(
        (credential): credential is PendingRememberedBrowserEnrollment =>
          credential.status === 'pending' && sameScope(credential, scope),
      ) ?? null
    )
  })
}

export async function confirmPendingBrowserEnrollmentWindow(
  expected: PendingRememberedBrowserEnrollment,
  enrollmentExpiresAt: string,
) {
  if (
    !Number.isFinite(Date.parse(enrollmentExpiresAt)) ||
    Date.parse(enrollmentExpiresAt) <= Date.now() ||
    Date.parse(enrollmentExpiresAt) > Date.now() + 5 * 60 * 1_000 + 5_000
  ) {
    throw new Error('Remembered-browser enrollment window is invalid.')
  }
  return withStore('readwrite', async (store) => {
    const current = (await requestResult(
      store.get(expected.id),
    )) as StoredRememberedBrowserCredential | undefined
    if (
      !current ||
      current.status !== 'pending' ||
      !samePendingEnrollment(current, expected)
    ) {
      return null
    }
    const replacement = {
      ...current,
      enrollmentExpiresAt,
    } satisfies PendingRememberedBrowserEnrollment
    await requestResult(store.put(replacement))
    return replacement
  })
}

export async function activatePendingRememberedBrowserEnrollment(
  expected: PendingRememberedBrowserEnrollment,
  expiresAt: string,
) {
  return withStore('readwrite', async (store) => {
    const current = (await requestResult(
      store.get(expected.id),
    )) as StoredRememberedBrowserCredential | undefined
    if (
      current?.status === 'active' &&
      current.expiresAt === expiresAt &&
      sameCredentialProvenance(current, expected)
    ) {
      return current
    }
    if (
      !current ||
      current.status !== 'pending' ||
      !samePendingEnrollment(current, expected)
    ) {
      return null
    }
    const active: RememberedBrowserCredential = {
      createdAt: current.createdAt,
      credentialToken: current.credentialToken,
      expiresAt,
      environmentId: current.environmentId,
      id: current.id,
      membershipId: current.membershipId,
      privateKey: current.privateKey,
      principalId: current.principalId,
      publicKeyFingerprint: current.publicKeyFingerprint,
      publicKeyJwk: current.publicKeyJwk,
      status: 'active',
    }
    await requestResult(store.put(active))
    return active
  })
}

export async function rotatePendingBrowserCompletionRequest(
  expected: PendingRememberedBrowserEnrollment,
) {
  return withStore('readwrite', async (store) => {
    const current = (await requestResult(
      store.get(expected.id),
    )) as StoredRememberedBrowserCredential | undefined
    if (
      !current ||
      current.status !== 'pending' ||
      !samePendingEnrollment(current, expected)
    ) {
      return null
    }
    const replacement = {
      ...current,
      completionRequestId: crypto.randomUUID(),
    } satisfies PendingRememberedBrowserEnrollment
    await requestResult(store.put(replacement))
    return replacement
  })
}

export async function signRememberedBrowserAssertion(
  credential: RememberedBrowserCredential,
  payload: string,
) {
  if (
    credential.privateKey.extractable ||
    credential.privateKey.algorithm.name !== 'ECDSA' ||
    !credential.privateKey.usages.includes('sign')
  ) {
    throw new Error('Remembered-browser key is invalid.')
  }
  const signature = await crypto.subtle.sign(
    { hash: 'SHA-256', name: 'ECDSA' },
    credential.privateKey,
    new TextEncoder().encode(payload),
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function clearPendingRememberedBrowserEnrollment(
  expected: PendingRememberedBrowserEnrollment,
) {
  return withStore('readwrite', async (store) => {
    const current = (await requestResult(
      store.get(expected.id),
    )) as StoredRememberedBrowserCredential | undefined
    if (
      !current ||
      current.status !== 'pending' ||
      !samePendingEnrollment(current, expected)
    ) {
      return false
    }
    await requestResult(store.delete(expected.id))
    return true
  })
}

export async function clearRememberedBrowserCredential(
  id: string,
  scope: RememberedBrowserIdentityScope,
) {
  return withStore('readwrite', async (store) => {
    const current = (await requestResult(
      store.get(id),
    )) as StoredRememberedBrowserCredential | undefined
    if (!current || current.status !== 'active' || !sameScope(current, scope)) {
      return false
    }
    await requestResult(store.delete(id))
    return true
  })
}

export async function clearAllRememberedBrowserCredentials() {
  await withStore('readwrite', async (store) => {
    await requestResult(store.clear())
  })
}
