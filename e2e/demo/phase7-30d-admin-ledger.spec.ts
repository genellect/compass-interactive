import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

test.skip(
  process.env.VITE_PHASE7_30_ADMIN_IDENTITY !== 'true' ||
    process.env.VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS !== 'true' ||
    process.env.VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER !== 'true',
  'Phase 7.30D Admin ledger requires its dedicated Google-only runner.',
)

const pendingStorageKey = 'compass-interactive-admin-ledger-pending-v1'
const appSessionToken = `g1.${'a'.repeat(43)}`
const invitationToken = 'i'.repeat(43)
const factorId = '730d0000-0000-4000-8000-000000000001'
const challengeId = '730d0000-0000-4000-8000-000000000002'
const authUserId = '730d0000-0000-4000-8000-000000000003'
const authSessionId = '730d0000-0000-4000-8000-000000000004'
const environmentId = '730d0000-0000-4000-8000-000000000005'
const ownerPrincipalId = '730d0000-0000-4000-8000-000000000006'
const ownerMembershipId = '730d0000-0000-4000-8000-000000000007'
const ownerSessionId = '730d0000-0000-4000-8000-000000000008'
const instructorPrincipalId = '730d0000-0000-4000-8000-000000000009'
const instructorMembershipId = '730d0000-0000-4000-8000-00000000000a'
const instructorSessionId = '730d0000-0000-4000-8000-00000000000b'
const priorInvitationId = '730d0000-0000-4000-8000-00000000000c'
const resultInvitationId = '730d0000-0000-4000-8000-00000000000d'
const aiInstructorPrincipalId = '730d0000-0000-4000-8000-00000000000e'
const aiInstructorMembershipId = '730d0000-0000-4000-8000-00000000000f'
const lectureSessionId = '730d0000-0000-4000-8000-000000000010'
const duplicateInvitationId = '730d0000-0000-4000-8000-000000000011'
const intentDigest = 'd'.repeat(64)
const policyIntentDigest = 'e'.repeat(64)
const policyId = '730d0000-0000-4000-8000-000000000012'

type AdminRole = 'instructor' | 'owner'

type FunctionCall = {
  authorization: string
  body: Record<string, unknown>
  functionName: string
}

type MockState = {
  admissionEnabled: boolean
  anonymousRequests: number
  authRequests: Array<{
    authorization: string
    method: string
    pathname: string
  }>
  commitBodies: Record<string, unknown>[]
  functionCalls: FunctionCall[]
  ledgerCompleteBodies: Record<string, unknown>[]
  ledgerCompleteAttempts: number
  ledgerGrantIssues: number
  openLecture: boolean
  pinControlBeganAtSeconds: number
  pinGrantAvailable: boolean
  pinGrantRequestId: string | null
  pinRegistered: boolean
  policyCompleteAttempts: number
  policyCovered: boolean
  policyGrantAvailable: boolean
  policySetAttempts: number
  unexpectedRequests: string[]
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function adminUser() {
  const now = new Date().toISOString()
  return {
    app_metadata: { provider: 'google', providers: ['google'] },
    aud: 'authenticated',
    confirmed_at: now,
    created_at: now,
    email: 'owner@example.test',
    email_confirmed_at: now,
    factors: [
      {
        created_at: now,
        factor_type: 'totp',
        friendly_name: 'Owner authenticator',
        id: factorId,
        status: 'verified',
        updated_at: now,
      },
    ],
    id: authUserId,
    identities: [
      {
        created_at: now,
        id: 'phase730d-google-subject',
        identity_data: {
          email: 'owner@example.test',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: 'phase730d-google-subject',
        },
        identity_id: '730d0000-0000-4000-8000-00000000000e',
        last_sign_in_at: now,
        provider: 'google',
        updated_at: now,
        user_id: authUserId,
      },
    ],
    is_anonymous: false,
    role: 'authenticated',
    updated_at: now,
    user_metadata: {
      email: 'owner@example.test',
      email_verified: true,
      sub: 'phase730d-google-subject',
    },
  }
}

function adminSession({
  issuedAgeSeconds,
  signature = 'phase730d-admin-signature',
  totpAgeSeconds = 60,
}: {
  issuedAgeSeconds?: number
  signature?: string
  totpAgeSeconds?: number
} = {}) {
  const user = adminUser()
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const tokenAgeSeconds = issuedAgeSeconds ?? Math.max(120, totpAgeSeconds + 60)
  const accessToken = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      aal: 'aal2',
      amr: [
        { method: 'oauth', timestamp: nowSeconds - tokenAgeSeconds },
        { method: 'totp', timestamp: nowSeconds - totpAgeSeconds },
      ],
      aud: 'authenticated',
      exp: nowSeconds + 3_600,
      iat: nowSeconds - tokenAgeSeconds,
      role: 'authenticated',
      session_id: authSessionId,
      sub: authUserId,
    }),
    signature,
  ].join('.')
  return {
    access_token: accessToken,
    expires_at: nowSeconds + 3_600,
    expires_in: 3_600,
    refresh_token: 'phase730d-admin-refresh-token',
    token_type: 'bearer',
    user,
  }
}

function studentSession() {
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const id = '730d0000-0000-4000-8000-00000000000f'
  const accessToken = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      aud: 'authenticated',
      exp: nowSeconds + 3_600,
      iat: nowSeconds - 60,
      role: 'authenticated',
      sub: id,
    }),
    'phase730d-student-signature',
  ].join('.')
  return {
    accessToken,
    storageValue: JSON.stringify({
      access_token: accessToken,
      expires_at: nowSeconds + 3_600,
      expires_in: 3_600,
      refresh_token: 'phase730d-student-refresh-token',
      token_type: 'bearer',
      user: {
        app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        id,
        is_anonymous: true,
        role: 'authenticated',
        updated_at: new Date().toISOString(),
        user_metadata: {},
      },
    }),
  }
}

function trackedAdminSession(role: AdminRole = 'owner') {
  const now = Date.now()
  const isOwner = role === 'owner'
  return {
    canUseAi: true,
    environmentId,
    expiresAt: new Date(now + 8 * 60 * 60_000).toISOString(),
    id: isOwner ? ownerSessionId : instructorSessionId,
    idleExpiresAt: new Date(now + 30 * 60_000).toISOString(),
    membershipId: isOwner ? ownerMembershipId : instructorMembershipId,
    principalId: isOwner ? ownerPrincipalId : instructorPrincipalId,
    role,
    stepUpVerifiedAt: new Date(now - 60_000).toISOString(),
  }
}

function ledgerSnapshot(
  ledgerAdmissionEnabled: boolean,
  openLecture: boolean,
  duplicatePendingInvitations = false,
) {
  const now = Date.now()
  const createdAt = new Date(now - 24 * 60 * 60_000).toISOString()
  const updatedAt = new Date(now - 60_000).toISOString()
  const expiresAt = new Date(now + 7 * 24 * 60 * 60_000).toISOString()
  return {
    currentMembershipId: ownerMembershipId,
    currentPrincipalId: ownerPrincipalId,
    currentSessionId: ownerSessionId,
    environmentId,
    environmentKind: 'production',
    invitations: [
      {
        canUseAi: true,
        createdAt,
        expiredAt: null,
        expiresAt,
        invitationId: priorInvitationId,
        membershipExpiresAt: new Date(
          now + 30 * 24 * 60 * 60_000,
        ).toISOString(),
        normalizedEmail: 'pending@example.test',
        revocationReason: null,
        revokedAt: null,
        role: 'instructor',
        status: 'pending',
        updatedAt,
      },
      ...(duplicatePendingInvitations
        ? [
            {
              canUseAi: false,
              createdAt,
              expiredAt: null,
              expiresAt,
              invitationId: duplicateInvitationId,
              membershipExpiresAt: null,
              normalizedEmail: 'pending@example.test',
              revocationReason: null,
              revokedAt: null,
              role: 'instructor',
              status: 'pending',
              updatedAt,
            },
          ]
        : []),
    ],
    ledgerAdmissionEnabled,
    memberships: [
      {
        canUseAi: true,
        createdAt,
        displayName: 'Current Owner',
        expiresAt: null,
        membershipId: ownerMembershipId,
        normalizedEmail: 'owner@example.test',
        principalId: ownerPrincipalId,
        principalStatus: 'active',
        role: 'owner',
        status: 'active',
        statusReason: null,
        updatedAt,
      },
      {
        canUseAi: false,
        createdAt,
        displayName: 'Lecture Instructor',
        expiresAt: new Date(now + 30 * 24 * 60 * 60_000).toISOString(),
        membershipId: instructorMembershipId,
        normalizedEmail: 'instructor@example.test',
        principalId: instructorPrincipalId,
        principalStatus: 'active',
        role: 'instructor',
        status: 'active',
        statusReason: null,
        updatedAt,
      },
      {
        canUseAi: true,
        createdAt,
        displayName: 'AI Lecture Instructor',
        expiresAt: new Date(now + 30 * 24 * 60 * 60_000).toISOString(),
        membershipId: aiInstructorMembershipId,
        normalizedEmail: 'ai-instructor@example.test',
        principalId: aiInstructorPrincipalId,
        principalStatus: 'active',
        role: 'instructor',
        status: 'active',
        statusReason: null,
        updatedAt,
      },
    ],
    ok: true,
    ownerships: openLecture
      ? [
          {
            assignedAt: createdAt,
            lectureSessionId,
            lectureStatus: 'open',
            membershipId: instructorMembershipId,
            principalId: instructorPrincipalId,
          },
        ]
      : [],
    sessions: [
      {
        expiresAt,
        idleExpiresAt: expiresAt,
        isCurrent: true,
        issuedAt: createdAt,
        lastSeenAt: updatedAt,
        membershipId: ownerMembershipId,
        revokeReason: null,
        revokedAt: null,
        sessionId: ownerSessionId,
        status: 'active',
      },
      {
        expiresAt,
        idleExpiresAt: expiresAt,
        isCurrent: false,
        issuedAt: createdAt,
        lastSeenAt: updatedAt,
        membershipId: instructorMembershipId,
        revokeReason: null,
        revokedAt: null,
        sessionId: instructorSessionId,
        status: 'active',
      },
    ],
  }
}

function managedLectures(openLecture: boolean) {
  if (!openLecture) return []
  const createdAt = new Date(Date.now() - 60 * 60_000).toISOString()
  return [
    {
      archiveExpiresAt: null,
      closedAt: null,
      closeActorType: null,
      closeReason: null,
      createdAt,
      endsAt: null,
      hardStopAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      id: lectureSessionId,
      journalClub: null,
      lectureCode: '730D01',
      startsAt: createdAt,
      status: 'open',
      title: '統計学入門',
      updatedAt: createdAt,
    },
  ]
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    headers: {
      ...(origin
        ? { 'access-control-allow-origin': origin, vary: 'Origin' }
        : {}),
      'cache-control': 'no-store',
    },
    status,
  })
}

async function installStoredSessions(
  page: Page,
  admin: ReturnType<typeof adminSession>,
  studentStorageValue: string,
) {
  await page.addInitScript(
    ({ admin, studentStorageValue }) => {
      window.localStorage.setItem(
        'compass-interactive-admin-supabase-auth-v1',
        JSON.stringify(admin),
      )
      window.sessionStorage.setItem(
        'compass-interactive-admin-google-app-session-v1',
        `g1.${'a'.repeat(43)}`,
      )
      window.localStorage.setItem('sb-example-auth-token', studentStorageValue)
      window.localStorage.setItem(
        'compass-interactive-participant-id',
        'phase730d-student-participant',
      )
    },
    { admin, studentStorageValue },
  )
}

async function installMocks(
  page: Page,
  admin: ReturnType<typeof adminSession>,
  options: {
    duplicatePendingInvitations?: boolean
    failFirstInvitationCommit?: boolean
    failFirstPolicySet?: boolean
    failFirstTotpVerification?: boolean
    failFirstTotpVerificationWithServiceUnavailable?: boolean
    invitationConflictOnCommit?: boolean
    loseFirstLedgerCompletionResponse?: boolean
    loseFirstPolicyCompletionResponse?: boolean
    refreshSessionOnTotp?: boolean
    role?: AdminRole
  } = {},
) {
  const {
    duplicatePendingInvitations = false,
    failFirstInvitationCommit = true,
    failFirstPolicySet = false,
    failFirstTotpVerification = false,
    failFirstTotpVerificationWithServiceUnavailable = false,
    invitationConflictOnCommit = false,
    loseFirstLedgerCompletionResponse = false,
    loseFirstPolicyCompletionResponse = false,
    refreshSessionOnTotp = false,
    role = 'owner',
  } = options
  let verifiedAdmin = admin
  const state: MockState = {
    admissionEnabled: false,
    anonymousRequests: 0,
    authRequests: [],
    commitBodies: [],
    functionCalls: [],
    ledgerCompleteBodies: [],
    ledgerCompleteAttempts: 0,
    ledgerGrantIssues: 0,
    openLecture: true,
    pinControlBeganAtSeconds: 0,
    pinGrantAvailable: false,
    pinGrantRequestId: null,
    pinRegistered: false,
    policyCompleteAttempts: 0,
    policyCovered: false,
    policyGrantAvailable: false,
    policySetAttempts: 0,
    unexpectedRequests: [],
  }
  let commitAttempts = 0
  let ledgerControlIntentDigest = ''
  let ledgerControlNonce = ''
  let ledgerControlRequestId = ''
  let ledgerGrantAvailable = false
  let totpVerifyAttempts = 0
  let pinControlIntentDigest = ''
  let pinControlNonce = ''
  let pinControlRequestId = ''

  await page.route('https://example.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const authorization = request.headers().authorization ?? ''

    if (url.pathname.startsWith('/auth/v1/')) {
      state.authRequests.push({
        authorization,
        method: request.method(),
        pathname: url.pathname,
      })
      if (url.pathname === '/auth/v1/signup') {
        state.anonymousRequests += 1
        state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
        await fulfillJson(
          route,
          { error: 'anonymous auth is not expected' },
          500,
        )
        return
      }
      if (url.pathname === '/auth/v1/authorize') {
        state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
        await fulfillJson(route, { error: 'OAuth is not expected' }, 500)
        return
      }
      if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
        await fulfillJson(route, admin.user)
        return
      }
      if (
        url.pathname === `/auth/v1/factors/${factorId}/challenge` &&
        request.method() === 'POST'
      ) {
        await fulfillJson(route, {
          expires_at: Math.floor(Date.now() / 1_000) + 300,
          id: challengeId,
          type: 'totp',
        })
        return
      }
      if (
        url.pathname === `/auth/v1/factors/${factorId}/verify` &&
        request.method() === 'POST'
      ) {
        totpVerifyAttempts += 1
        if (failFirstTotpVerification && totpVerifyAttempts === 1) {
          await fulfillJson(
            route,
            {
              code: 'mfa_verification_failed',
              error_code: 'mfa_verification_failed',
              message: 'mocked verification failure',
            },
            422,
          )
          return
        }
        if (
          failFirstTotpVerificationWithServiceUnavailable &&
          totpVerifyAttempts === 1
        ) {
          await fulfillJson(
            route,
            {
              code: 'service_unavailable',
              message: 'mocked authentication service failure',
            },
            503,
          )
          return
        }
        if (refreshSessionOnTotp) {
          verifiedAdmin = adminSession({
            issuedAgeSeconds: 0,
            signature: 'phase730d-admin-fresh-signature',
            totpAgeSeconds: 1,
          })
        }
        await fulfillJson(route, verifiedAdmin)
        return
      }
      state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
      await fulfillJson(route, { error: 'unexpected auth request' }, 500)
      return
    }

    if (url.pathname.startsWith('/functions/v1/')) {
      const functionName = url.pathname.split('/').at(-1) ?? ''
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
      state.functionCalls.push({ authorization, body, functionName })

      if (functionName === 'admin-identity-session') {
        const action = String(body.action ?? '')
        if (action === 'status') {
          await fulfillJson(route, {
            ok: true,
            session: trackedAdminSession(role),
          })
          return
        }
        if (action === 'beginControlStepUp') {
          const controlStepUpNonce =
            body.controlStepUpNonce ?? `n.${'b'.repeat(41)}`
          if (body.controlAction === 'admin_invitation_change') {
            ledgerControlIntentDigest = String(body.controlIntentDigest)
            ledgerControlNonce = String(controlStepUpNonce)
            ledgerControlRequestId = String(body.controlRequestId)
          }
          if (body.controlAction === 'ai_pin_enroll') {
            state.pinControlBeganAtSeconds = Math.floor(Date.now() / 1_000)
            pinControlIntentDigest = String(body.controlIntentDigest)
            pinControlNonce = String(controlStepUpNonce)
            pinControlRequestId = String(body.controlRequestId)
          }
          await fulfillJson(route, {
            controlAction: body.controlAction,
            controlIntentDigest: body.controlIntentDigest,
            controlOperationKey: body.controlOperationKey,
            controlRequestId: body.controlRequestId,
            controlStepUpNonce,
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            ok: true,
          })
          return
        }
        if (action === 'completeControlStepUp') {
          if (body.controlAction === 'admin_invitation_change') {
            state.ledgerCompleteAttempts += 1
            state.ledgerCompleteBodies.push(JSON.parse(JSON.stringify(body)))
            if (
              authorization !== `Bearer ${verifiedAdmin.access_token}` ||
              body.controlIntentDigest !== ledgerControlIntentDigest ||
              body.controlRequestId !== ledgerControlRequestId ||
              body.controlStepUpNonce !== ledgerControlNonce
            ) {
              state.unexpectedRequests.push('invalid ledger control proof')
              await fulfillJson(
                route,
                { code: 'request_invalid', ok: false },
                400,
              )
              return
            }
            if (!ledgerGrantAvailable) {
              ledgerGrantAvailable = true
              state.ledgerGrantIssues += 1
            }
            if (
              loseFirstLedgerCompletionResponse &&
              state.ledgerCompleteAttempts === 1
            ) {
              await fulfillJson(
                route,
                { code: 'service_unavailable', ok: false },
                503,
              )
              return
            }
          }
          if (body.controlAction === 'ai_pin_enroll') {
            if (
              authorization !== `Bearer ${verifiedAdmin.access_token}` ||
              body.controlIntentDigest !== pinControlIntentDigest ||
              body.controlRequestId !== pinControlRequestId ||
              body.controlStepUpNonce !== pinControlNonce
            ) {
              state.unexpectedRequests.push('invalid AI PIN control proof')
              await fulfillJson(
                route,
                { code: 'request_invalid', ok: false },
                400,
              )
              return
            }
            state.pinGrantAvailable = true
            state.pinGrantRequestId = String(body.controlRequestId)
          }
          if (body.controlAction === 'environment_ai_policy_change') {
            state.policyCompleteAttempts += 1
            state.policyGrantAvailable = true
            if (
              loseFirstPolicyCompletionResponse &&
              state.policyCompleteAttempts === 1
            ) {
              await fulfillJson(
                route,
                { code: 'service_unavailable', ok: false },
                503,
              )
              return
            }
          }
          await fulfillJson(route, {
            controlAction: body.controlAction,
            controlIntentDigest: body.controlIntentDigest,
            controlOperationKey: body.controlOperationKey,
            controlRequestId: body.controlRequestId,
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            ok: true,
            verifiedTotpAmrAt: new Date().toISOString(),
          })
          return
        }
        state.unexpectedRequests.push(
          `identity action ${action || '<missing>'}`,
        )
        await fulfillJson(route, { code: 'request_invalid', ok: false }, 400)
        return
      }

      if (functionName === 'admin-ai-unlock') {
        const action = String(body.action ?? '')
        if (action === 'profile') {
          await fulfillJson(route, {
            activeBrowserCount: 0,
            activePin: state.pinRegistered,
            canUseAi: true,
            factorStatus: state.pinRegistered ? 'active' : null,
            factorVersion: state.pinRegistered ? 1 : null,
            ok: true,
            pinPepperVersion: state.pinRegistered ? 1 : null,
            rememberedBrowserEnabled: false,
            role,
          })
          return
        }
        if (action === 'preparePinMutation') {
          const expectedKeys = [
            'action',
            'appSessionToken',
            'pin',
            'pinAction',
            'requestId',
          ]
          if (
            JSON.stringify(Object.keys(body).sort()) !==
              JSON.stringify(expectedKeys.sort()) ||
            body.pin !== '1357' ||
            body.pinAction !== 'enroll' ||
            typeof body.requestId !== 'string'
          ) {
            await fulfillJson(
              route,
              { code: 'request_invalid', ok: false },
              400,
            )
            return
          }
          await fulfillJson(route, {
            controlAction: 'ai_pin_enroll',
            controlIntentDigest: 'f'.repeat(64),
            ok: true,
            requestId: body.requestId,
          })
          return
        }
        if (action === 'setPin') {
          const requestId = String(body.requestId ?? '')
          const expectedAuthorization = state.pinGrantAvailable
            ? `Bearer ${verifiedAdmin.access_token}`
            : `Bearer ${admin.access_token}`
          if (
            body.pin !== '1357' ||
            authorization !== expectedAuthorization ||
            !state.pinGrantAvailable ||
            state.pinGrantRequestId !== requestId
          ) {
            await fulfillJson(
              route,
              { code: 'control_proof_required', ok: false },
              409,
            )
            return
          }
          state.pinGrantAvailable = false
          state.pinGrantRequestId = null
          state.pinRegistered = true
          await fulfillJson(route, {
            factorVersion: 1,
            ok: true,
            status: 'active',
          })
          return
        }
        if (action === 'policyStatus') {
          const now = Date.now()
          await fulfillJson(route, {
            activeAiMembershipCount: 2,
            canonicalPolicyTopologyComplete: state.policyCovered,
            coveredMembershipCount: state.policyCovered ? 2 : 1,
            memberships: [
              {
                covered: true,
                maxCostMicrousdPerDay: 2_000_000,
                maxCostMicrousdPerLecture: 500_000,
                membershipId: ownerMembershipId,
                policyId: '730d0000-0000-4000-8000-000000000011',
                policyStatus: 'active',
                policyVersion: 1,
                validFrom: new Date(now - 60_000).toISOString(),
                validUntil: new Date(now + 30 * 24 * 60 * 60_000).toISOString(),
              },
              {
                covered: state.policyCovered,
                maxCostMicrousdPerDay: state.policyCovered ? 2_000_000 : null,
                maxCostMicrousdPerLecture: state.policyCovered ? 500_000 : null,
                membershipId: aiInstructorMembershipId,
                policyId: state.policyCovered ? policyId : null,
                policyStatus: state.policyCovered ? 'active' : null,
                policyVersion: state.policyCovered ? 1 : null,
                validFrom: state.policyCovered
                  ? new Date(now - 60_000).toISOString()
                  : null,
                validUntil: state.policyCovered
                  ? new Date(now + 30 * 24 * 60 * 60_000).toISOString()
                  : null,
              },
            ],
            ok: true,
            topologyComplete: state.policyCovered,
          })
          return
        }
        if (action === 'preparePolicyMutation' || action === 'setPolicy') {
          const expectedKeys = [
            'action',
            'appSessionToken',
            'maxCostMicrousdPerDay',
            'maxCostMicrousdPerLecture',
            'requestId',
            'targetMembershipId',
            'validFrom',
            'validUntil',
          ]
          const receivedKeys = Object.keys(body).sort()
          if (
            JSON.stringify(receivedKeys) !==
              JSON.stringify([...expectedKeys].sort()) ||
            body.targetMembershipId !== aiInstructorMembershipId ||
            body.maxCostMicrousdPerLecture !== 500_000 ||
            body.maxCostMicrousdPerDay !== 2_000_000
          ) {
            await fulfillJson(
              route,
              { code: 'request_invalid', ok: false },
              400,
            )
            return
          }
          if (action === 'preparePolicyMutation') {
            await fulfillJson(route, {
              controlAction: 'environment_ai_policy_change',
              controlIntentDigest: policyIntentDigest,
              ok: true,
              requestId: body.requestId,
              targetMembershipId: body.targetMembershipId,
            })
            return
          }
          state.policySetAttempts += 1
          if (!state.policyGrantAvailable) {
            await fulfillJson(
              route,
              { code: 'control_proof_required', ok: false },
              409,
            )
            return
          }
          if (failFirstPolicySet && state.policySetAttempts === 1) {
            await fulfillJson(
              route,
              { code: 'service_unavailable', ok: false },
              503,
            )
            return
          }
          state.policyGrantAvailable = false
          state.policyCovered = true
          await fulfillJson(route, {
            membershipId: body.targetMembershipId,
            ok: true,
            policyId,
            status: 'active',
            version: 1,
          })
          return
        }
        state.unexpectedRequests.push(
          `ai unlock action ${action || '<missing>'}`,
        )
        await fulfillJson(route, { code: 'request_invalid', ok: false }, 400)
        return
      }

      if (functionName === 'manage-admin-ledger') {
        if (body.action === 'snapshot') {
          await fulfillJson(
            route,
            ledgerSnapshot(
              state.admissionEnabled,
              state.openLecture,
              duplicatePendingInvitations,
            ),
          )
          return
        }
        if (body.action === 'audit') {
          await fulfillJson(route, {
            events: [
              {
                action: 'admin_ledger.enableAi',
                eventId: '730d0000-0000-4000-8000-000000000011',
                occurredAt: new Date(Date.now() - 30_000).toISOString(),
                reasonCode: 'state_changed',
                result: 'denied',
                targetId: instructorMembershipId,
                targetType: 'admin_membership',
              },
            ],
            ok: true,
          })
          return
        }
        if (body.stage === 'intent' && body.action === 'issueInvitation') {
          await fulfillJson(route, {
            controlStepUpAction: 'admin_invitation_change',
            intentDigest,
            ok: true,
            operationKey: 'manage-admin-ledger.issueInvitation',
            requestId: body.requestId,
            targetId: resultInvitationId,
          })
          return
        }
        if (body.stage === 'commit' && body.action === 'issueInvitation') {
          state.commitBodies.push(JSON.parse(JSON.stringify(body)))
          commitAttempts += 1
          if (invitationConflictOnCommit) {
            await fulfillJson(
              route,
              { code: 'invitation_pending', ok: false },
              409,
            )
            return
          }
          if (failFirstInvitationCommit && commitAttempts === 1) {
            await fulfillJson(
              route,
              { code: 'service_unavailable', ok: false },
              503,
            )
            return
          }
          await fulfillJson(route, {
            idempotentReplay: true,
            invitationToken,
            ok: true,
            refreshRequired: true,
            resultId: resultInvitationId,
            resultStatus: 'pending',
          })
          return
        }
        state.unexpectedRequests.push(
          `ledger ${String(body.stage ?? body.action ?? '<missing>')}`,
        )
        await fulfillJson(route, { code: 'request_invalid', ok: false }, 400)
        return
      }

      if (functionName === 'manage-lectures') {
        if (body.action === 'list') {
          await fulfillJson(route, {
            lectures: managedLectures(state.openLecture),
            ok: true,
          })
          return
        }
        if (
          body.action === 'emergencyStop' &&
          body.lectureSessionId === lectureSessionId
        ) {
          state.openLecture = false
          await fulfillJson(route, { lectures: [], ok: true })
          return
        }
      }

      state.unexpectedRequests.push(`function ${functionName}`)
      await fulfillJson(route, { code: 'unexpected_function', ok: false }, 500)
      return
    }

    state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
    await fulfillJson(route, { error: 'unexpected Supabase request' }, 500)
  })

  return state
}

async function openLedger(page: Page) {
  await page.goto('/admin/settings')
  await expect(
    page.getByRole('heading', { name: '教員管理', exact: true }),
  ).toBeVisible()
  const panel = page.locator('.admin-ledger-panel')
  await expect(panel.getByRole('heading', { name: '教員一覧' })).toBeVisible()
  await expect(panel).not.toHaveAttribute('aria-busy', 'true')
  return panel
}

test('keeps safe owner controls available while OFF and exactly recovers one invitation after a lost response', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession()
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin)

  let panel = await openLedger(page)
  await expect(
    panel.getByText(
      '新しい教員の招待は停止中です。権限停止とログイン失効は利用できます。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(panel.getByLabel('運用状況')).toContainText('有効な教員3')
  await expect(panel.getByLabel('運用状況')).toContainText('ログイン中2')
  await expect(panel.getByLabel('運用状況')).toContainText('進行中の講義1')
  await expect(panel.getByLabel('運用状況')).toContainText('要確認1')
  await expect(panel.getByRole('heading', { name: '要確認' })).toBeVisible()
  await expect(
    panel.locator('.admin-ledger-review').getByText(/AI利用を許可.*拒否/),
  ).toBeVisible()
  await expect(panel.getByText('統計学入門', { exact: true })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await panel.getByRole('button', { name: '講義を停止' }).click()
  await expect(panel.getByText('講義を終了しました。')).toBeVisible()
  expect(
    state.functionCalls.filter(
      ({ body, functionName }) =>
        functionName === 'manage-lectures' &&
        body.action === 'emergencyStop' &&
        body.lectureSessionId === lectureSessionId,
    ),
  ).toHaveLength(1)
  await expect(panel.getByLabel('運用状況')).toContainText('進行中の講義0')
  await expect(panel.getByText('進行中の講義はありません。')).toBeVisible()
  for (const permission of [
    '管理者（全権限付与）',
    '教員（AI利用可）',
    '教員（AI利用不可）',
  ]) {
    await expect(
      panel.getByText(permission, { exact: true }).first(),
    ).toBeVisible()
  }
  await panel.getByText('教員を追加', { exact: true }).click()
  await expect(panel.getByLabel('AI利用を許可')).not.toBeChecked()
  await expect(panel.getByLabel('役割')).toHaveCount(0)
  await expect(panel.getByLabel('招待リンクの期限')).toHaveCount(0)
  await expect(panel.getByLabel('利用期限')).toHaveCount(0)
  await expect(
    panel.getByRole('button', { name: '招待リンクを作成' }),
  ).toBeDisabled()
  await expect(
    panel.getByRole('button', { name: '管理者権限を付与' }),
  ).toHaveCount(0)
  const rowActions = panel.locator('.admin-ledger-row-actions')
  for (let index = 0; index < (await rowActions.count()); index += 1) {
    await rowActions.nth(index).locator('summary').click()
  }
  await expect(
    panel.getByRole('button', { name: 'AI利用を許可' }),
  ).toBeDisabled()
  for (const label of [
    '最新状態を確認',
    'AI利用を停止',
    '教員権限を一時停止',
    '教員権限を抹消',
    '全ログインを失効',
    'このログインを失効',
  ]) {
    await expect(
      panel.getByRole('button', { name: label }).first(),
    ).toBeEnabled()
  }
  await panel.getByText('招待履歴 (1)', { exact: true }).click()
  await expect(
    panel.getByRole('button', { name: '招待を取り消す' }),
  ).toBeEnabled()
  await expect(page.locator('body')).not.toContainText(
    /feature_disabled|manage-admin-ledger|ledgerAdmissionEnabled|P73\d+/,
  )

  state.admissionEnabled = true
  await panel.getByRole('button', { name: '最新状態を確認' }).click()
  const intentCountBeforeDuplicate = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'manage-admin-ledger' && body.stage === 'intent',
  ).length
  await panel
    .getByLabel('Googleアカウントのメールアドレス')
    .fill(' PENDING@example.test ')
  await expect(
    panel.getByText('この教員には受諾待ちの招待があります。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    panel.getByRole('button', { name: '招待リンクを作成' }),
  ).toBeDisabled()
  await expect(
    panel.getByRole('button', { name: 'この招待を取り消す' }),
  ).toBeEnabled()
  await expect(panel.getByLabel('6桁コード')).toHaveCount(0)
  expect(
    state.functionCalls.filter(
      ({ body, functionName }) =>
        functionName === 'manage-admin-ledger' && body.stage === 'intent',
    ),
  ).toHaveLength(intentCountBeforeDuplicate)
  await panel
    .getByLabel('Googleアカウントのメールアドレス')
    .fill('new-admin@example.test')
  await expect(
    panel.getByText('この教員には受諾待ちの招待があります。', {
      exact: true,
    }),
  ).toHaveCount(0)
  await expect(
    panel.getByRole('button', { name: '招待リンクを作成' }),
  ).toBeEnabled()
  await panel.getByRole('button', { name: '招待リンクを作成' }).click()
  await expect(
    panel.getByRole('heading', { name: '変更を確認', exact: true }),
  ).toBeVisible()
  await expect(
    panel.getByText('認証アプリの6桁コードを入力してください。', {
      exact: true,
    }),
  ).toBeVisible()
  const invitationTotp = panel.getByLabel('6桁コード')
  await expect(invitationTotp).toBeFocused()
  await expect(panel.getByRole('button', { name: 'キャンセル' })).toBeVisible()
  await expect(panel.locator('.admin-ledger-confirmation')).toHaveAttribute(
    'aria-describedby',
    'admin-ledger-confirmation-instruction',
  )
  await invitationTotp.fill('123456')
  await panel.getByRole('button', { name: 'この変更を実行' }).click()
  await expect(
    panel.getByRole('heading', {
      name: '変更の承認は完了しています',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    panel.getByText('通信が一時的に失敗しました。本人確認は完了しています。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    panel.getByText(
      '6桁コードの再入力は不要です。反映結果を確認してください。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    panel.getByRole('button', { name: '変更の完了を確認する' }),
  ).toBeVisible()
  await expect(panel.getByLabel('6桁コード')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'キャンセル' })).toHaveCount(0)

  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = window.sessionStorage.getItem(key)
        return raw ? JSON.parse(raw).pending?.phase : null
      }, pendingStorageKey),
    )
    .toBe('authorized')

  const storedPending = await page.evaluate((key) => {
    const raw = window.sessionStorage.getItem(key)
    return raw ? { parsed: JSON.parse(raw), raw } : null
  }, pendingStorageKey)
  expect(storedPending?.parsed.pending.phase).toBe('authorized')
  expect(storedPending?.raw).not.toContain('123456')
  expect(storedPending?.raw).not.toContain(appSessionToken)
  expect(storedPending?.raw).not.toContain(invitationToken)

  await page.reload()
  panel = await openLedger(page)
  await expect(
    panel.getByRole('heading', {
      name: '変更の承認は完了しています',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    panel.getByText(
      '6桁コードの再入力は不要です。反映結果を確認してください。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(panel.getByLabel('6桁コード')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'キャンセル' })).toHaveCount(0)
  await panel.getByRole('button', { name: '変更の完了を確認する' }).click()
  await expect(
    panel.getByText('今回だけ表示される招待リンク', { exact: true }),
  ).toBeVisible()
  await expect(
    panel.locator('.admin-ledger-invitation-link input'),
  ).toHaveValue(new RegExp(`#invite=${invitationToken}$`))
  await expect
    .poll(() =>
      page.evaluate((key) => sessionStorage.getItem(key), pendingStorageKey),
    )
    .toBeNull()

  const intentCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'manage-admin-ledger' && body.stage === 'intent',
  )
  const beginCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-identity-session' &&
      body.action === 'beginControlStepUp',
  )
  const completeCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-identity-session' &&
      body.action === 'completeControlStepUp',
  )
  expect(intentCalls).toHaveLength(1)
  const invitationPayload = intentCalls[0]?.body.payload as
    Record<string, unknown> | undefined
  expect(invitationPayload).toMatchObject({
    canUseAi: false,
    membershipExpiresAt: null,
    normalizedEmail: 'new-admin@example.test',
    role: 'instructor',
  })
  const invitationExpiry = Date.parse(String(invitationPayload?.expiresAt))
  expect(invitationExpiry).toBeGreaterThan(Date.now() + 47 * 60 * 60_000)
  expect(invitationExpiry).toBeLessThan(Date.now() + 49 * 60 * 60_000)
  expect(beginCalls).toHaveLength(1)
  expect(completeCalls).toHaveLength(1)
  expect(state.commitBodies).toHaveLength(2)
  expect(state.commitBodies[1]).toEqual(state.commitBodies[0])
  expect(state.commitBodies[0]?.requestId).toBe(intentCalls[0]?.body.requestId)
  expect(state.commitBodies[0]?.intentDigest).toBe(intentDigest)
  expect(beginCalls[0]?.body).toMatchObject({
    appSessionToken,
    controlAction: 'admin_invitation_change',
    controlIntentDigest: intentDigest,
    controlOperationKey: 'manage-admin-ledger.issueInvitation',
    controlRequestId: intentCalls[0]?.body.requestId,
  })
  expect(completeCalls[0]?.body).toMatchObject({
    appSessionToken,
    controlAction: 'admin_invitation_change',
    controlIntentDigest: intentDigest,
    controlOperationKey: 'manage-admin-ledger.issueInvitation',
    controlRequestId: intentCalls[0]?.body.requestId,
  })
  expect(
    state.authRequests.filter(({ pathname }) =>
      pathname.includes('/challenge'),
    ),
  ).toHaveLength(1)
  expect(
    state.authRequests.filter(({ pathname }) => pathname.includes('/verify')),
  ).toHaveLength(1)
  expect(state.anonymousRequests).toBe(0)
  expect(
    state.functionCalls.some(
      ({ functionName }) => functionName === 'verify-admin-pin',
    ),
  ).toBe(false)
  expect(
    state.functionCalls.every(
      ({ authorization, body }) =>
        authorization === `Bearer ${admin.access_token}` &&
        body.appSessionToken === appSessionToken &&
        !('adminToken' in body) &&
        !('pin' in body),
    ),
  ).toBe(true)
  expect(
    state.authRequests.some(
      ({ authorization }) => authorization === `Bearer ${student.accessToken}`,
    ),
  ).toBe(false)
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])

  if (testInfo.project.name === 'mobile-webkit') {
    const accessibility = await new AxeBuilder({ page })
      .include('.admin-ledger-panel')
      .analyze()
    expect(
      accessibility.violations
        .filter((violation) =>
          ['critical', 'serious'].includes(violation.impact ?? ''),
        )
        .map((violation) => violation.id),
    ).toEqual([])
    await expect
      .poll(() =>
        page.evaluate(() => {
          const panel = document.querySelector<HTMLElement>(
            '.admin-ledger-panel',
          )
          return Boolean(
            panel &&
            document.documentElement.scrollWidth <=
              document.documentElement.clientWidth + 1 &&
            panel.scrollWidth <= panel.clientWidth + 1,
          )
        }),
      )
      .toBe(true)
  }
})

test('fails closed when an inconsistent snapshot contains duplicate pending invitations', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession()
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin, {
    duplicatePendingInvitations: true,
  })

  const panel = await openLedger(page)
  state.admissionEnabled = true
  await panel.getByRole('button', { name: '最新状態を確認' }).click()
  await panel.getByText('教員を追加', { exact: true }).click()
  const emailInput = panel.getByLabel('Googleアカウントのメールアドレス')
  await emailInput.fill('pending@example.test')

  await expect(
    panel.getByText(
      '招待状態を確認できません。新しい招待を作成せず、最新状態を確認してください。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    panel.getByRole('button', { name: '招待リンクを作成' }),
  ).toBeDisabled()
  await expect(
    panel.getByRole('button', { name: 'この招待を取り消す' }),
  ).toHaveCount(0)

  const intentCountBeforeSubmit = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'manage-admin-ledger' && body.stage === 'intent',
  ).length
  await emailInput.press('Enter')
  await expect(panel.getByLabel('6桁コード')).toHaveCount(0)
  expect(
    state.functionCalls.filter(
      ({ body, functionName }) =>
        functionName === 'manage-admin-ledger' && body.stage === 'intent',
    ),
  ).toHaveLength(intentCountBeforeSubmit)
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])
})

test('explains an invitation conflict and clears the stale confirmation', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession()
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin, {
    failFirstInvitationCommit: false,
    invitationConflictOnCommit: true,
  })

  const panel = await openLedger(page)
  state.admissionEnabled = true
  await panel.getByRole('button', { name: '最新状態を確認' }).click()
  await panel.getByText('教員を追加', { exact: true }).click()
  await panel
    .getByLabel('Googleアカウントのメールアドレス')
    .fill('conflict@example.test')
  await panel.getByRole('button', { name: '招待リンクを作成' }).click()
  await panel.getByLabel('6桁コード').fill('123456')
  await panel.getByRole('button', { name: 'この変更を実行' }).click()

  await expect(
    panel.getByText(
      'この教員には受諾待ちの招待があります。取り消してから、新しい招待リンクを作成してください。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(panel.locator('.admin-ledger-confirmation')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate((key) => sessionStorage.getItem(key), pendingStorageKey),
    )
    .toBeNull()
  expect(state.commitBodies).toHaveLength(1)
  expect(
    state.authRequests.filter(({ pathname }) =>
      pathname.includes('/challenge'),
    ),
  ).toHaveLength(1)
  expect(
    state.authRequests.filter(({ pathname }) => pathname.includes('/verify')),
  ).toHaveLength(1)
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])
})

test('keeps the intended change and gives one clear next step after a rejected TOTP code', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession()
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin, {
    failFirstTotpVerification: true,
  })

  const panel = await openLedger(page)
  state.admissionEnabled = true
  await panel.getByRole('button', { name: '最新状態を確認' }).click()
  await panel.getByText('教員を追加', { exact: true }).click()
  await panel
    .getByLabel('Googleアカウントのメールアドレス')
    .fill('totp-retry@example.test')
  await panel.getByRole('button', { name: '招待リンクを作成' }).click()
  await panel.getByLabel('6桁コード').fill('123456')
  await panel.getByRole('button', { name: 'この変更を実行' }).click()

  await expect(
    panel.getByText(
      '認証コードを確認できませんでした。新しい6桁コードを入力して、もう一度実行してください。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    panel.getByRole('heading', { name: '変更を確認', exact: true }),
  ).toBeVisible()
  await expect(panel.getByLabel('6桁コード')).toHaveValue('')
  await expect(panel.getByLabel('6桁コード')).toBeFocused()
  await expect(panel.getByRole('button', { name: 'キャンセル' })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = sessionStorage.getItem(key)
        return raw ? JSON.parse(raw).pending?.phase : null
      }, pendingStorageKey),
    )
    .toBe('control')
  expect(state.ledgerCompleteAttempts).toBe(0)
  expect(state.commitBodies).toHaveLength(0)
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])
})

test('does not blame the TOTP code when the authentication service is unavailable', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession()
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin, {
    failFirstTotpVerificationWithServiceUnavailable: true,
  })

  const panel = await openLedger(page)
  state.admissionEnabled = true
  await panel.getByRole('button', { name: '最新状態を確認' }).click()
  await panel.getByText('教員を追加', { exact: true }).click()
  await panel
    .getByLabel('Googleアカウントのメールアドレス')
    .fill('totp-network@example.test')
  await panel.getByRole('button', { name: '招待リンクを作成' }).click()
  await panel.getByLabel('6桁コード').fill('123456')
  await panel.getByRole('button', { name: 'この変更を実行' }).click()

  await expect(
    panel.getByText(
      '認証サービスとの通信に失敗しました。コードの正誤は確認されていません。通信状態を確認して、もう一度実行してください。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(panel.getByLabel('6桁コード')).toHaveValue('123456')
  await expect(panel.getByLabel('6桁コード')).toBeFocused()
  await expect(panel.getByRole('button', { name: 'キャンセル' })).toBeVisible()
  expect(state.ledgerCompleteAttempts).toBe(0)
  expect(state.commitBodies).toHaveLength(0)
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])
})

test('resumes a verified invitation change without another TOTP challenge', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession()
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin, {
    failFirstInvitationCommit: false,
    loseFirstLedgerCompletionResponse: true,
  })

  let panel = await openLedger(page)
  state.admissionEnabled = true
  await panel.getByRole('button', { name: '最新状態を確認' }).click()
  await panel.getByText('教員を追加', { exact: true }).click()
  await panel
    .getByLabel('Googleアカウントのメールアドレス')
    .fill('recovery-instructor@example.test')
  await panel.getByRole('button', { name: '招待リンクを作成' }).click()
  await panel.getByLabel('6桁コード').fill('123456')
  await panel.getByRole('button', { name: 'この変更を実行' }).click()

  await expect(
    panel.getByRole('heading', {
      name: '本人確認は完了しています',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    panel.getByText('通信が一時的に失敗しました。本人確認は完了しています。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    panel.getByText('6桁コードの再入力は不要です。処理を続けてください。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    panel.getByRole('button', { name: '認証済みの処理を続ける' }),
  ).toBeVisible()
  await expect(panel.getByLabel('6桁コード')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'キャンセル' })).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = window.sessionStorage.getItem(key)
        return raw ? JSON.parse(raw).pending?.phase : null
      }, pendingStorageKey),
    )
    .toBe('completing')

  await page.reload()
  panel = await openLedger(page)
  await expect(
    panel.getByRole('heading', {
      name: '本人確認は完了しています',
      exact: true,
    }),
  ).toBeVisible()
  await expect(panel.getByLabel('6桁コード')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'キャンセル' })).toHaveCount(0)
  await panel.getByRole('button', { name: '認証済みの処理を続ける' }).click()

  await expect(
    panel.getByText('今回だけ表示される招待リンク', { exact: true }),
  ).toBeVisible()
  await expect.poll(() => state.ledgerCompleteAttempts).toBe(2)
  expect(state.ledgerCompleteBodies).toHaveLength(2)
  expect(state.ledgerCompleteBodies[1]).toEqual(state.ledgerCompleteBodies[0])
  expect(state.ledgerGrantIssues).toBe(1)
  expect(state.commitBodies).toHaveLength(1)
  expect(
    state.authRequests.filter(({ pathname }) =>
      pathname.includes('/challenge'),
    ),
  ).toHaveLength(1)
  expect(
    state.authRequests.filter(({ pathname }) => pathname.includes('/verify')),
  ).toHaveLength(1)
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])
})

test('completes one AI PIN enrollment with one Authenticator challenge and the same request', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession({ totpAgeSeconds: 600 })
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin, {
    refreshSessionOnTotp: true,
  })

  await openLedger(page)
  const summary = page.locator('summary').filter({ hasText: 'AI PINの設定' })
  await expect(summary).toHaveCount(1)
  const pinPanel = summary.locator('..')
  await summary.click()

  await pinPanel.getByLabel('4桁の新AI PIN').fill('1357')
  await pinPanel.getByLabel('確認', { exact: true }).fill('1357')
  await pinPanel.getByRole('button', { name: 'PINを登録' }).click()
  await expect(
    pinPanel.getByLabel('認証アプリの6桁コード（今回のみ）'),
  ).toBeVisible()
  await pinPanel.getByLabel('認証アプリの6桁コード（今回のみ）').fill('123456')
  await pinPanel.getByRole('button', { name: '重要操作を承認' }).click()

  await expect(pinPanel.getByLabel('同じ新PINを再入力')).toBeVisible()
  await expect(
    pinPanel.getByLabel('認証アプリの6桁コード（今回のみ）'),
  ).toHaveCount(0)
  await pinPanel.getByLabel('同じ新PINを再入力').fill('1357')
  await pinPanel.getByRole('button', { name: 'PINを登録' }).click()

  await expect(
    pinPanel.getByText('AI PINを登録しました。', { exact: true }),
  ).toBeVisible()
  await expect.poll(() => state.pinRegistered).toBe(true)
  await expect(
    pinPanel.getByRole('button', { name: 'PINを変更' }),
  ).toBeVisible()

  const prepareCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-ai-unlock' &&
      body.action === 'preparePinMutation',
  )
  const setCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-ai-unlock' && body.action === 'setPin',
  )
  const beginCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-identity-session' &&
      body.action === 'beginControlStepUp' &&
      body.controlAction === 'ai_pin_enroll',
  )
  const completeCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-identity-session' &&
      body.action === 'completeControlStepUp' &&
      body.controlAction === 'ai_pin_enroll',
  )
  expect(prepareCalls).toHaveLength(1)
  expect(setCalls).toHaveLength(2)
  expect(setCalls[1]?.body.requestId).toBe(setCalls[0]?.body.requestId)
  expect(prepareCalls[0]?.body.requestId).toBe(setCalls[0]?.body.requestId)
  expect(setCalls[0]?.authorization).toBe(`Bearer ${admin.access_token}`)
  expect(setCalls[1]?.authorization).not.toBe(setCalls[0]?.authorization)
  const staleJwt = JSON.parse(
    Buffer.from(admin.access_token.split('.')[1] ?? '', 'base64url').toString(),
  ) as {
    amr: Array<{ method: string; timestamp: number }>
    iat: number
    session_id: string
  }
  const freshJwt = JSON.parse(
    Buffer.from(
      setCalls[1]?.authorization.split(' ')[1]?.split('.')[1] ?? '',
      'base64url',
    ).toString(),
  ) as {
    amr: Array<{ method: string; timestamp: number }>
    iat: number
    session_id: string
  }
  expect(freshJwt.session_id).toBe(staleJwt.session_id)
  expect(freshJwt.iat).toBeGreaterThan(staleJwt.iat)
  expect(freshJwt.iat).toBeGreaterThanOrEqual(
    state.pinControlBeganAtSeconds - 1,
  )
  expect(
    freshJwt.amr.find(({ method }) => method === 'totp')?.timestamp,
  ).toBeGreaterThan(
    staleJwt.amr.find(({ method }) => method === 'totp')?.timestamp ?? 0,
  )
  expect(beginCalls).toHaveLength(1)
  expect(completeCalls).toHaveLength(1)
  expect(beginCalls[0]?.body.controlRequestId).toBe(setCalls[0]?.body.requestId)
  expect(completeCalls[0]?.body.controlRequestId).toBe(
    setCalls[0]?.body.requestId,
  )
  expect(completeCalls[0]?.authorization).toBe(setCalls[1]?.authorization)
  expect(completeCalls[0]?.body.controlIntentDigest).toBe('f'.repeat(64))
  expect(completeCalls[0]?.body.controlStepUpNonce).toBeTruthy()
  expect(
    state.authRequests.filter(({ pathname }) =>
      pathname.includes('/challenge'),
    ),
  ).toHaveLength(1)
  expect(
    state.authRequests.filter(({ pathname }) => pathname.includes('/verify')),
  ).toHaveLength(1)
  expect(
    await page.evaluate(() =>
      JSON.stringify(
        [localStorage, sessionStorage].flatMap((storage) =>
          Array.from({ length: storage.length }, (_, index) => {
            const key = storage.key(index)
            return key ? [key, storage.getItem(key)] : []
          }),
        ),
      ),
    ),
  ).not.toContain('1357')
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])
})

test('keeps AI policy Owner-only and recovers exact mutation after lost TOTP and policy responses', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession()
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin, {
    failFirstPolicySet: true,
    loseFirstPolicyCompletionResponse: true,
  })

  await openLedger(page)
  const summary = page
    .locator('summary')
    .filter({ hasText: '講義AIの利用設定' })
  await expect(summary).toHaveCount(1)
  const policyPanel = summary.locator('..')
  await expect(policyPanel).not.toHaveAttribute('open', '')
  await summary.click()
  await expect(summary).toBeVisible()
  await expect(policyPanel).toHaveAttribute('open', '')

  const target = policyPanel.getByLabel('対象の教員')
  const lectureCost = policyPanel.getByLabel('講義ごとの上限（USD）')
  const dailyCost = policyPanel.getByLabel('1日ごとの上限（USD）')
  const submit = policyPanel.getByRole('button', {
    name: 'この設定で利用を許可',
  })
  await target.selectOption(aiInstructorMembershipId)
  await policyPanel.getByLabel('確認に使う認証アプリ').selectOption(factorId)
  await expect(lectureCost).toHaveValue(/^(?:0\.5|0\.50)$/)
  await expect(dailyCost).toHaveValue(/^(?:2|2\.0|2\.00)$/)

  await lectureCost.fill('2.01')
  await dailyCost.fill('2.00')
  await submit.click()
  await expect(
    policyPanel.getByText(
      'コスト上限は講義0.01〜5.00 USD、1日0.01〜20.00 USDで入力してください。',
      { exact: true },
    ),
  ).toBeVisible()
  expect(
    state.functionCalls.filter(
      ({ body, functionName }) =>
        functionName === 'admin-ai-unlock' &&
        body.action === 'preparePolicyMutation',
    ),
  ).toHaveLength(0)

  await lectureCost.fill('0.50')
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(
    policyPanel.getByRole('button', { name: '保留中の設定を取り消す' }),
  ).toBeVisible()
  await policyPanel.getByLabel('6桁コード').fill('123456')
  await policyPanel.getByRole('button', { name: '認証アプリで確認' }).click()
  await expect(
    policyPanel.getByRole('button', { name: '同じ内容で再試行' }),
  ).toBeVisible()
  await policyPanel.getByRole('button', { name: '同じ内容で再試行' }).click()
  await expect(
    policyPanel.getByRole('button', { name: '同じ内容で再試行' }),
  ).toBeVisible()
  await policyPanel.getByRole('button', { name: '同じ内容で再試行' }).click()

  await expect.poll(() => state.policyCovered).toBe(true)
  await expect
    .poll(
      () =>
        state.functionCalls.filter(
          ({ body, functionName }) =>
            functionName === 'admin-ai-unlock' &&
            body.action === 'policyStatus',
        ).length,
    )
    .toBeGreaterThanOrEqual(2)

  const statusCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-ai-unlock' && body.action === 'policyStatus',
  )
  const prepareCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-ai-unlock' &&
      body.action === 'preparePolicyMutation',
  )
  const setCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-ai-unlock' && body.action === 'setPolicy',
  )
  const beginCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-identity-session' &&
      body.action === 'beginControlStepUp' &&
      body.controlAction === 'environment_ai_policy_change',
  )
  const completeCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-identity-session' &&
      body.action === 'completeControlStepUp' &&
      body.controlAction === 'environment_ai_policy_change',
  )
  expect(statusCalls.length).toBeGreaterThanOrEqual(2)
  for (const { body } of statusCalls) {
    expect(Object.keys(body).sort()).toEqual(['action', 'appSessionToken'])
  }
  expect(prepareCalls).toHaveLength(1)
  expect(setCalls).toHaveLength(2)
  expect(setCalls[1]?.body).toEqual(setCalls[0]?.body)
  const preparePayload = { ...(prepareCalls[0]?.body ?? {}) }
  const setPayload = { ...(setCalls[0]?.body ?? {}) }
  delete preparePayload.action
  delete setPayload.action
  expect(setPayload).toEqual(preparePayload)
  expect(prepareCalls[0]?.body).toMatchObject({
    appSessionToken,
    maxCostMicrousdPerDay: 2_000_000,
    maxCostMicrousdPerLecture: 500_000,
    targetMembershipId: aiInstructorMembershipId,
  })
  const mutationBody = prepareCalls[0]?.body ?? {}
  expect(typeof mutationBody.requestId).toBe('string')
  expect(Date.parse(String(mutationBody.validFrom))).not.toBeNaN()
  expect(Date.parse(String(mutationBody.validUntil))).not.toBeNaN()
  expect(
    Date.parse(String(mutationBody.validUntil)) -
      Date.parse(String(mutationBody.validFrom)),
  ).toBe(30 * 24 * 60 * 60_000)
  for (const forbiddenPresetField of [
    'allowedActions',
    'allowedModels',
    'maxCallsPerDay',
    'maxCallsPerLecture',
    'maxConcurrency',
    'maxInputTokensPerDay',
    'maxInputTokensPerLecture',
    'maxOutputTokensPerDay',
    'maxOutputTokensPerLecture',
    'maxRealtimeMinutesPerDay',
    'maxRealtimeMinutesPerLecture',
  ]) {
    expect(mutationBody).not.toHaveProperty(forbiddenPresetField)
  }
  expect(beginCalls).toHaveLength(1)
  expect(completeCalls).toHaveLength(1)
  expect(state.policyCompleteAttempts).toBe(1)
  expect(beginCalls[0]?.body).toMatchObject({
    appSessionToken,
    controlAction: 'environment_ai_policy_change',
    controlIntentDigest: policyIntentDigest,
    controlRequestId: mutationBody.requestId,
  })
  expect(completeCalls[0]?.body).toMatchObject({
    appSessionToken,
    controlAction: 'environment_ai_policy_change',
    controlIntentDigest: policyIntentDigest,
    controlRequestId: mutationBody.requestId,
  })
  expect(
    state.authRequests.filter(({ pathname }) =>
      pathname.includes('/challenge'),
    ),
  ).toHaveLength(1)
  expect(
    state.authRequests.filter(({ pathname }) => pathname.includes('/verify')),
  ).toHaveLength(1)
  expect(
    await page.evaluate(() =>
      JSON.stringify(
        [localStorage, sessionStorage].flatMap((storage) =>
          Array.from({ length: storage.length }, (_, index) => {
            const key = storage.key(index)
            return key ? [key, storage.getItem(key)] : []
          }),
        ),
      ),
    ),
  ).not.toContain('123456')
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])
})

test('keeps the settings route available to an Instructor without exposing Owner AI policy controls', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession()
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin, { role: 'instructor' })

  await page.goto('/admin')
  await expect(
    page.getByRole('link', { name: '教員管理', exact: true }),
  ).toHaveCount(0)

  await page.goto('/admin/settings')
  await expect(page).toHaveURL('/admin/settings')
  await expect(page.locator('main')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'AI PINの設定', exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('summary').filter({ hasText: '講義AIの利用設定' }),
  ).toHaveCount(0)
  await expect(page.locator('.admin-ledger-panel')).toHaveCount(0)
  expect(
    state.functionCalls.filter(
      ({ body, functionName }) =>
        functionName === 'admin-ai-unlock' && body.action === 'policyStatus',
    ),
  ).toHaveLength(0)
  expect(
    state.functionCalls.filter(
      ({ functionName }) => functionName === 'manage-admin-ledger',
    ),
  ).toHaveLength(0)
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])
})
