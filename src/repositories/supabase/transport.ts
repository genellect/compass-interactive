import { supabase } from '../../lib/supabaseClient'
import { displaySupabase } from '../../lib/displaySupabaseClient'
import {
  getAdminOperationCredentialBody,
  isAdminOperationCredential,
  type AdminOperationCredential,
} from '../../lib/adminAuth/adminOperationCredential'
import { adminSupabase } from '../../lib/adminAuth/adminSupabaseClient'
import {
  AdminIdentityError,
  restoreGoogleAdminSession,
} from '../../lib/adminAuth/adminIdentityApi'
import {
  completeAdminOperationRequestId,
  reserveAdminOperationRequestId,
} from '../../lib/adminAuth/adminOperationRequestId'
import { notifyGoogleAdminSessionInvalid } from '../../lib/adminAuth/adminOperationSessionEvents'

type EdgeFunctionInvokeOptions = NonNullable<
  Parameters<typeof supabase.functions.invoke>[1]
>

const GOOGLE_ADMIN_SESSION_INVALID_CODES = new Set([
  'aal2_required',
  'app_session_invalid',
  'identity_invalid',
])

const GOOGLE_REQUEST_ID_FREE_ACTIONS = new Map<string, ReadonlySet<string>>([
  ['generate-academic-answer', new Set(['status'])],
  ['display-session-status', new Set(['status'])],
  ['manage-ai-activation-intent', new Set(['status'])],
  ['manage-admin-sessions', new Set(['list'])],
  ['manage-admin-ledger', new Set(['audit', 'snapshot'])],
  ['manage-ai-control', new Set(['status'])],
  ['manage-lecture-summaries', new Set(['status'])],
  ['manage-lectures', new Set(['list'])],
  ['manage-material-analysis', new Set(['list'])],
  ['manage-pdf-documents', new Set(['list'])],
  ['manage-pdf-publications', new Set(['discover', 'status'])],
  ['manage-polls', new Set(['list'])],
  ['manage-presenter-connection', new Set(['status'])],
  ['operator-live-snapshot', new Set(['commentHistory', 'snapshot'])],
])

function requiresGeneratedRequestId(
  functionName: string,
  body: Record<string, unknown>,
) {
  const action = typeof body.action === 'string' ? body.action : ''
  return GOOGLE_REQUEST_ID_FREE_ACTIONS.get(functionName)?.has(action) !== true
}

async function isGoogleAdminSessionInvalid(error: unknown) {
  const response = (error as { context?: unknown } | null)?.context
  if (!(response instanceof Response) || response.status !== 401) return false
  if (
    !response.headers.get('content-type')?.toLowerCase().includes('json') ||
    !response.headers.get('cache-control')?.toLowerCase().includes('no-store')
  ) {
    return false
  }
  try {
    const text = await response.clone().text()
    if (text.length > 4_096) return false
    const payload = JSON.parse(text) as { code?: unknown }
    return (
      typeof payload.code === 'string' &&
      GOOGLE_ADMIN_SESSION_INVALID_CODES.has(payload.code)
    )
  } catch {
    return false
  }
}

async function confirmGoogleAdminSessionInvalid(
  error: unknown,
  appSessionToken: string,
) {
  if (!error) return false
  if (await isGoogleAdminSessionInvalid(error)) return true

  // A domain facade can fail after the trusted Edge verification but before
  // it obtains the application-session row. Recheck the identity endpoint so
  // a generic domain error cannot leave an expired Admin workspace mounted,
  // while ordinary validation/authorization errors never force a logout.
  try {
    await restoreGoogleAdminSession(appSessionToken)
    return false
  } catch (sessionError) {
    return (
      sessionError instanceof AdminIdentityError &&
      GOOGLE_ADMIN_SESSION_INVALID_CODES.has(sessionError.code)
    )
  }
}

export async function invokeEdgeFunction<T>(
  functionName: string,
  options: EdgeFunctionInvokeOptions,
) {
  const suppliedAdminCredential =
    options.body && typeof options.body === 'object'
      ? (options.body as Record<string, unknown>).adminToken
      : undefined
  if (
    suppliedAdminCredential !== undefined &&
    !isAdminOperationCredential(suppliedAdminCredential)
  ) {
    throw new Error('Google Admin credential is required.')
  }
  if (isAdminOperationCredential(suppliedAdminCredential)) {
    const { adminToken: credential, ...body } = options.body as Record<
      string,
      unknown
    > & { adminToken: AdminOperationCredential }
    const requestBody = {
      ...body,
      ...getAdminOperationCredentialBody(credential),
    } as Record<string, unknown>
    const client = adminSupabase
    const reservedRequest =
      requestBody.requestId === undefined &&
      requiresGeneratedRequestId(functionName, body)
        ? reserveAdminOperationRequestId(functionName, body)
        : null
    if (reservedRequest) requestBody.requestId = reservedRequest.requestId

    const result = await client.functions.invoke<T>(functionName, {
      ...options,
      body: requestBody,
    })
    if (
      await confirmGoogleAdminSessionInvalid(
        result.error,
        credential.appSessionToken,
      )
    ) {
      notifyGoogleAdminSessionInvalid(credential.appSessionToken)
    }
    if (!result.error && reservedRequest) {
      completeAdminOperationRequestId(
        reservedRequest.key,
        reservedRequest.requestId,
      )
    }
    return result
  }
  const suppliedDisplayToken =
    options.body && typeof options.body === 'object'
      ? (options.body as Record<string, unknown>).displayToken
      : undefined
  const client =
    typeof suppliedDisplayToken === 'string' && suppliedDisplayToken.length > 0
      ? displaySupabase
      : supabase
  return await client.functions.invoke<T>(functionName, options)
}
