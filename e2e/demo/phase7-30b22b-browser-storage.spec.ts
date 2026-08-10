import { expect, test } from '@playwright/test'

const scopeA = {
  environmentId: '73022000-0000-4000-8000-000000000001',
  membershipId: '73022000-0000-4000-8000-000000000002',
  principalId: '73022000-0000-4000-8000-000000000003',
}
const scopeB = {
  environmentId: scopeA.environmentId,
  membershipId: '73022000-0000-4000-8000-000000000004',
  principalId: '73022000-0000-4000-8000-000000000005',
}
const recoveryScopeA = {
  authSessionId: '73022000-0000-4000-8000-000000000011',
  authUserId: '73022000-0000-4000-8000-000000000012',
}
const recoveryScopeB = {
  authSessionId: '73022000-0000-4000-8000-000000000013',
  authUserId: recoveryScopeA.authUserId,
}

test.beforeEach(async ({ page }) => {
  await page.goto('/join')
  await page.evaluate(async () => {
    const browser = await import(
      /* @vite-ignore */ String('/src/lib/adminAuth/rememberedBrowserCredential.ts')
    )
    await browser.clearAllRememberedBrowserCredentials()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(
        'compass-interactive-admin-totp-recovery-v1',
      )
      request.addEventListener('success', () => resolve(), { once: true })
      request.addEventListener('error', () => reject(request.error), {
        once: true,
      })
      request.addEventListener('blocked', () => reject(new Error('blocked')), {
        once: true,
      })
    })
  })
})

test('keeps one non-extractable pending key across tabs and reload', async ({
  context,
  page,
}) => {
  const secondPage = await context.newPage()
  await secondPage.goto('/join')

  const create = (target: typeof page) =>
    target.evaluate(async (scope) => {
      const browser = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/rememberedBrowserCredential.ts')
      )
      const pending =
        await browser.createPendingRememberedBrowserEnrollment(scope)
      let exportRejected = false
      try {
        await crypto.subtle.exportKey('pkcs8', pending.privateKey)
      } catch {
        exportRejected = true
      }
      return {
        exportRejected,
        extractable: pending.privateKey.extractable,
        id: pending.id,
        status: pending.status,
      }
    }, scopeA)

  const [first, second] = await Promise.all([create(page), create(secondPage)])
  expect(first.id).toBe(second.id)
  expect(first.status).toBe('pending')
  expect(first.extractable).toBe(false)
  expect(first.exportRejected).toBe(true)

  await page.reload()
  const restored = await page.evaluate(async (scope) => {
    const browser = await import(
      /* @vite-ignore */ String('/src/lib/adminAuth/rememberedBrowserCredential.ts')
    )
    const pending = await browser.getPendingRememberedBrowserEnrollment(scope)
    return pending
      ? { extractable: pending.privateKey.extractable, id: pending.id }
      : null
  }, scopeA)
  expect(restored).toEqual({ extractable: false, id: first.id })

  const activeExpiresAt = new Date(Date.now() + 60_000).toISOString()
  for (const target of [page, secondPage]) {
    await target.evaluate(async (scope) => {
      const browser = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/rememberedBrowserCredential.ts')
      )
      const pending = await browser.getPendingRememberedBrowserEnrollment(scope)
      if (!pending) throw new Error('pending enrollment missing')
      ;(window as Window & { __b22bPending?: unknown }).__b22bPending = pending
    }, scopeA)
  }
  const activate = (target: typeof page) =>
    target.evaluate(
      async ({ expiresAt }) => {
        const browser = await import(
          /* @vite-ignore */ String('/src/lib/adminAuth/rememberedBrowserCredential.ts')
        )
        const pending = (window as Window & { __b22bPending?: unknown })
          .__b22bPending
        if (!pending) throw new Error('pending enrollment missing')
        const active =
          await browser.activatePendingRememberedBrowserEnrollment(
            pending,
            expiresAt,
          )
        return active?.id ?? null
      },
      { expiresAt: activeExpiresAt },
    )
  const [activeFirst, activeSecond] = await Promise.all([
    activate(page),
    activate(secondPage),
  ])
  expect(activeFirst).toBe(first.id)
  expect(activeSecond).toBe(first.id)
})

test('scopes credentials per teacher and purges only expired active records', async ({
  page,
}) => {
  const result = await page.evaluate(
    async ({ scopeA, scopeB }) => {
      const browser = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/rememberedBrowserCredential.ts')
      )
      const pendingA =
        await browser.createPendingRememberedBrowserEnrollment(scopeA)
      await browser.activatePendingRememberedBrowserEnrollment(
        pendingA,
        new Date(Date.now() + 60_000).toISOString(),
      )
      const pendingB =
        await browser.createPendingRememberedBrowserEnrollment(scopeB)
      await browser.activatePendingRememberedBrowserEnrollment(
        pendingB,
        new Date(Date.now() + 60_000).toISOString(),
      )
      const beforeA = await browser.listRememberedBrowserCredentials(scopeA)
      const beforeB = await browser.listRememberedBrowserCredentials(scopeB)
      await browser.clearRememberedBrowserCredential(pendingA.id, scopeB)
      const wrongScopeStillPresent =
        (await browser.listRememberedBrowserCredentials(scopeA)).length
      await browser.clearRememberedBrowserCredential(pendingA.id, scopeA)

      const expired = await browser.createPendingRememberedBrowserEnrollment(
        scopeA,
        new Date(Date.now() - 1_000).toISOString(),
      )
      await browser.activatePendingRememberedBrowserEnrollment(
        expired,
        new Date(Date.now() - 1_000).toISOString(),
      )
      const afterExpiry = await browser.listRememberedBrowserCredentials(scopeA)
      const expiredLookup = await browser.getRememberedBrowserCredential(
        expired.id,
        scopeA,
      )
      return {
        afterExpiry: afterExpiry.length,
        beforeA: beforeA.length,
        beforeB: beforeB.length,
        expiredLookup,
        otherTeacherAfter: (
          await browser.listRememberedBrowserCredentials(scopeB)
        ).length,
        wrongScopeStillPresent,
      }
    },
    { scopeA, scopeB },
  )
  expect(result).toEqual({
    afterExpiry: 0,
    beforeA: 1,
    beforeB: 1,
    expiredLookup: null,
    otherTeacherAfter: 1,
    wrongScopeStillPresent: 1,
  })
})

test('replaces an expired pending enrollment atomically across tabs', async ({
  context,
  page,
}) => {
  const originalId = await page.evaluate(async (scope) => {
    const browser = await import(
      /* @vite-ignore */ String('/src/lib/adminAuth/rememberedBrowserCredential.ts')
    )
    const pending = await browser.createPendingRememberedBrowserEnrollment(scope)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('compass-interactive-admin-ai-v1', 1)
      request.addEventListener(
        'success',
        () => {
          const database = request.result
          const transaction = database.transaction(
            'remembered-browser-credentials',
            'readwrite',
          )
          const store = transaction.objectStore(
            'remembered-browser-credentials',
          )
          store.put({
            ...pending,
            enrollmentExpiresAt: new Date(Date.now() - 1_000).toISOString(),
          })
          transaction.addEventListener('complete', () => {
            database.close()
            resolve()
          })
          transaction.addEventListener('error', () => reject(transaction.error))
        },
        { once: true },
      )
      request.addEventListener('error', () => reject(request.error), {
        once: true,
      })
    })
    return pending.id
  }, scopeA)
  const secondPage = await context.newPage()
  await secondPage.goto('/join')
  const replace = (target: typeof page) =>
    target.evaluate(async (scope) => {
      const browser = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/rememberedBrowserCredential.ts')
      )
      return (await browser.createPendingRememberedBrowserEnrollment(scope)).id
    }, scopeA)
  const [first, second] = await Promise.all([replace(page), replace(secondPage)])
  expect(first).toBe(second)
  expect(first).not.toBe(originalId)
})

test('binds durable TOTP recovery to one Auth user and Auth session', async ({
  context,
  page,
}) => {
  const recoveryTokens: string[] = []
  await context.route(
    'https://example.supabase.co/functions/v1/admin-ai-unlock',
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      if (body.action === 'authorizeTotpTransition') {
        recoveryTokens.push(String(body.recoveryToken ?? ''))
        if (body.requestId === '73022000-0000-4000-8000-000000000099') {
          await route.fulfill({
            body: JSON.stringify({
              code: 'relogin_required',
              message: 'Sign in again.',
              recoveryUnused: true,
            }),
            contentType: 'application/json',
            headers: { 'cache-control': 'no-store' },
            status: 409,
          })
          return
        }
        await route.fulfill({
          body: JSON.stringify({
            expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
            ok: true,
          }),
          contentType: 'application/json',
          headers: { 'cache-control': 'no-store' },
          status: 200,
        })
        return
      }
      await route.fulfill({
        body: JSON.stringify({ ok: true, status: 'finalized' }),
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        status: 200,
      })
    },
  )
  const input = {
    action: 'totp_factor_add' as const,
    intentDigest: 'a'.repeat(64),
    mutationRequestId: '73022000-0000-4000-8000-000000000021',
    recoveryExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    targetFactorId: '73022000-0000-4000-8000-000000000022',
  }
  const secondPage = await context.newPage()
  await secondPage.goto('/join')
  const authorize = (target: typeof page) =>
    target.evaluate(
      async ({ input, scope }) => {
        const recovery = await import(
          /* @vite-ignore */ String('/src/lib/adminAuth/adminTotpTransitionRecovery.ts')
        )
        return recovery.authorizeAndPersistTotpFactorTransition(
          scope,
          `g1.${'a'.repeat(43)}`,
          input,
        )
      },
      { input, scope: recoveryScopeA },
    )
  const [first, second] = await Promise.all([
    authorize(page),
    authorize(secondPage),
  ])
  expect(first.finalizeRequestId).toBe(second.finalizeRequestId)
  expect(new Set(recoveryTokens).size).toBe(1)

  const scoped = await page.evaluate(
    async ({ own, other }) => {
      const recovery = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/adminTotpTransitionRecovery.ts')
      )
      return {
        other: await recovery.restoreAdminTotpTransitionRecovery(other),
        own: await recovery.restoreAdminTotpTransitionRecovery(own),
      }
    },
    { other: recoveryScopeB, own: recoveryScopeA },
  )
  expect(scoped.own?.mutationRequestId).toBe(input.mutationRequestId)
  expect(scoped.other).toBeNull()

  await page.evaluate(
    async ({ recovery: publicRecovery, scope }) => {
      const recovery = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/adminTotpTransitionRecovery.ts')
      )
      await recovery.finalizePersistedTotpFactorTransition(
        scope,
        publicRecovery,
      )
    },
    { recovery: first, scope: recoveryScopeA },
  )
  expect(
    await page.evaluate(async (scope) => {
      const recovery = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/adminTotpTransitionRecovery.ts')
      )
      return recovery.restoreAdminTotpTransitionRecovery(scope)
    }, recoveryScopeA),
  ).toBeNull()
})

test('recovers an unconfirmed local claim only through exact DB authorization replay', async ({
  context,
  page,
}) => {
  let authorizeAttempts = 0
  const recoveryTokens: string[] = []
  await context.route(
    'https://example.supabase.co/functions/v1/admin-ai-unlock',
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      if (body.action !== 'authorizeTotpTransition') {
        await route.fulfill({
          body: JSON.stringify({ code: 'request_invalid', ok: false }),
          contentType: 'application/json',
          status: 400,
        })
        return
      }
      authorizeAttempts += 1
      recoveryTokens.push(String(body.recoveryToken ?? ''))
      if (authorizeAttempts === 1) {
        // Simulate a transport failure before the Edge/DB request commits. The
        // IDB token must survive, but it is not permission to mutate GoTrue.
        await route.abort('failed')
        return
      }
      await route.fulfill({
        body: JSON.stringify({
          expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
          ok: true,
          status: 'authorized',
        }),
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        status: 200,
      })
    },
  )
  const input = {
    action: 'totp_factor_remove' as const,
    intentDigest: 'b'.repeat(64),
    mutationRequestId: '73022000-0000-4000-8000-000000000031',
    recoveryExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    targetFactorId: '73022000-0000-4000-8000-000000000032',
  }

  const firstFailed = await page.evaluate(
    async ({ input, scope }) => {
      const recovery = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/adminTotpTransitionRecovery.ts')
      )
      try {
        await recovery.authorizeAndPersistTotpFactorTransition(
          scope,
          `g1.${'b'.repeat(43)}`,
          input,
        )
        return false
      } catch {
        return true
      }
    },
    { input, scope: recoveryScopeA },
  )
  expect(firstFailed).toBe(true)

  await page.reload()
  const recovered = await page.evaluate(
    async ({ input, scope }) => {
      const recovery = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/adminTotpTransitionRecovery.ts')
      )
      const before = await recovery.restoreAdminTotpTransitionRecovery(scope)
      if (!before) throw new Error('unconfirmed recovery claim missing')
      const after = await recovery.authorizeAndPersistTotpFactorTransition(
        scope,
        `g1.${'b'.repeat(43)}`,
        input,
      )
      return {
        afterFinalizeRequestId: after.finalizeRequestId,
        beforeFinalizeRequestId: before.finalizeRequestId,
      }
    },
    { input, scope: recoveryScopeA },
  )
  expect(recovered.afterFinalizeRequestId).toBe(recovered.beforeFinalizeRequestId)
  expect(authorizeAttempts).toBe(2)
  expect(new Set(recoveryTokens).size).toBe(1)
})

test('lets DB discard an unused claim after the five-minute boundary', async ({
  context,
  page,
}) => {
  let authorizeAttempts = 0
  await context.route(
    'https://example.supabase.co/functions/v1/admin-ai-unlock',
    async (route) => {
      authorizeAttempts += 1
      if (authorizeAttempts === 1) {
        await route.fulfill({
          body: JSON.stringify({
            code: 'control_proof_required',
            message: 'Fresh control approval is required.',
            ok: false,
          }),
          contentType: 'application/json',
          headers: { 'cache-control': 'no-store' },
          status: 409,
        })
        return
      }
      await route.fulfill({
        body: JSON.stringify({
          code: 'relogin_required',
          message: 'Sign in again.',
          ok: false,
          recoveryUnused: true,
        }),
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        status: 409,
      })
    },
  )
  const input = {
    action: 'totp_factor_add' as const,
    intentDigest: 'c'.repeat(64),
    mutationRequestId: '73022000-0000-4000-8000-000000000041',
    recoveryExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    targetFactorId: '73022000-0000-4000-8000-000000000042',
  }
  await page.evaluate(
    async ({ input, scope }) => {
      const recovery = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/adminTotpTransitionRecovery.ts')
      )
      await recovery
        .authorizeAndPersistTotpFactorTransition(
          scope,
          `g1.${'c'.repeat(43)}`,
          input,
        )
        .catch(() => undefined)
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(
          'compass-interactive-admin-totp-recovery-v1',
          2,
        )
        request.addEventListener(
          'success',
          () => {
            const database = request.result
            const transaction = database.transaction(
              'active-transition',
              'readwrite',
            )
            const store = transaction.objectStore('active-transition')
            const id = `${scope.authUserId}:${scope.authSessionId}`
            const get = store.get(id)
            get.addEventListener('success', () => {
              store.put({
                ...get.result,
                expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
              })
            })
            transaction.addEventListener('complete', () => {
              database.close()
              resolve()
            })
            transaction.addEventListener('error', () => reject(transaction.error))
          },
          { once: true },
        )
        request.addEventListener('error', () => reject(request.error), {
          once: true,
        })
      })
    },
    { input, scope: recoveryScopeA },
  )

  const discarded = await page.evaluate(
    async ({ input, scope }) => {
      const recovery = await import(
        /* @vite-ignore */ String('/src/lib/adminAuth/adminTotpTransitionRecovery.ts')
      )
      const existing = await recovery.restoreAdminTotpTransitionRecovery(scope)
      if (!existing) throw new Error('boundary recovery claim missing')
      try {
        await recovery.authorizeAndPersistTotpFactorTransition(
          scope,
          `g1.${'c'.repeat(43)}`,
          { ...input, recoveryExpiresAt: existing.expiresAt },
        )
      } catch {
        // P7334/recoveryUnused is expected and must remove this exact token.
      }
      return (await recovery.restoreAdminTotpTransitionRecovery(scope)) === null
    },
    { input, scope: recoveryScopeA },
  )
  expect(authorizeAttempts).toBe(2)
  expect(discarded).toBe(true)
})
