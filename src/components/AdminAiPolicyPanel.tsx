import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  ADMIN_AI_POLICY_PRESET,
  AdminAiUnlockError,
  createAdminAiPolicyMutationRequest,
  getAdminAiPolicyStatus,
  prepareAdminAiPolicyMutation,
  setAdminAiPolicy,
  type AdminAiPolicyMutationRequest,
  type AdminAiPolicyStatus,
} from '../lib/adminAuth/adminAiUnlockApi'
import { ADMIN_AI_POLICY_PENDING_STORAGE_KEY } from '../lib/adminAuth/adminAuthStorage'
import {
  beginAdminControlStepUp,
  completeAdminControlStepUp,
  createAdminControlStepUpNonce,
} from '../lib/adminAuth/adminIdentityApi'
import { adminSupabase } from '../lib/adminAuth/adminSupabaseClient'
import type { AdminLedgerMembership } from '../lib/adminAuth/adminLedgerApi'

type FactorOption = { id: string; label: string }

type PendingPolicyMutation = AdminAiPolicyMutationRequest & {
  controlIntentDigest?: string
  controlStepUpNonce: string
  factorId?: string
  phase: 'authorized' | 'completing' | 'control' | 'preparing' | 'ready'
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const RECOVERY_LIFETIME_MS = 24 * 60 * 60 * 1_000

function clearStoredPendingPolicy() {
  try {
    window.sessionStorage.removeItem(ADMIN_AI_POLICY_PENDING_STORAGE_KEY)
  } catch {
    // Recovery storage must never block a safe control operation.
  }
}

function persistPendingPolicy(pending: PendingPolicyMutation) {
  try {
    window.sessionStorage.setItem(
      ADMIN_AI_POLICY_PENDING_STORAGE_KEY,
      JSON.stringify({ createdAt: Date.now(), pending }),
    )
  } catch {
    // The database request remains exact even when browser recovery is absent.
  }
}

function restorePendingPolicy(): PendingPolicyMutation | null {
  try {
    const raw = window.sessionStorage.getItem(
      ADMIN_AI_POLICY_PENDING_STORAGE_KEY,
    )
    if (!raw) return null
    const stored = JSON.parse(raw) as {
      createdAt?: unknown
      pending?: Record<string, unknown>
    }
    const pending = stored.pending
    const phase = String(pending?.phase)
    if (
      typeof stored.createdAt !== 'number' ||
      !Number.isSafeInteger(stored.createdAt) ||
      stored.createdAt > Date.now() ||
      Date.now() - stored.createdAt > RECOVERY_LIFETIME_MS ||
      !pending ||
      !UUID_PATTERN.test(String(pending.requestId)) ||
      !UUID_PATTERN.test(String(pending.targetMembershipId)) ||
      !NONCE_PATTERN.test(String(pending.controlStepUpNonce)) ||
      !Number.isSafeInteger(pending.maxCostMicrousdPerLecture) ||
      !Number.isSafeInteger(pending.maxCostMicrousdPerDay) ||
      typeof pending.validFrom !== 'string' ||
      typeof pending.validUntil !== 'string' ||
      !['authorized', 'completing', 'control', 'preparing', 'ready'].includes(
        phase,
      ) ||
      (phase !== 'preparing' &&
        (!SHA256_PATTERN.test(String(pending.controlIntentDigest)) ||
          !UUID_PATTERN.test(String(pending.factorId))))
    ) {
      throw new Error('invalid pending Admin AI policy operation')
    }
    return pending as PendingPolicyMutation
  } catch {
    clearStoredPendingPolicy()
    return null
  }
}

function dollarsToMicrousd(value: string, maximum: number) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(value.trim())) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0.01 || amount > maximum) return null
  return Math.round(amount * 1_000_000)
}

function policyMessage(error: unknown) {
  if (error instanceof AdminAiUnlockError) return error.message
  return error instanceof Error
    ? error.message
    : '講義AIの利用設定を完了できませんでした。'
}

function toPolicyRequest(
  pending: PendingPolicyMutation,
): AdminAiPolicyMutationRequest {
  return {
    maxCostMicrousdPerDay: pending.maxCostMicrousdPerDay,
    maxCostMicrousdPerLecture: pending.maxCostMicrousdPerLecture,
    requestId: pending.requestId,
    targetMembershipId: pending.targetMembershipId,
    validFrom: pending.validFrom,
    validUntil: pending.validUntil,
  }
}

function membershipLabel(membership: AdminLedgerMembership) {
  const identity = membership.displayName?.trim() || membership.normalizedEmail
  return `${identity}（${membership.role === 'owner' ? 'Owner' : '教員'}）`
}

export function AdminAiPolicyPanel({
  appSessionToken,
  disabled,
  factors,
  memberships,
  onPendingChange,
}: {
  appSessionToken: string
  disabled: boolean
  factors: FactorOption[]
  memberships: AdminLedgerMembership[]
  onPendingChange: (pending: boolean) => void
}) {
  const eligibleMemberships = useMemo(
    () =>
      memberships.filter(
        (membership) =>
          membership.status === 'active' &&
          membership.canUseAi &&
          (!membership.expiresAt ||
            Date.parse(membership.expiresAt) > Date.now()),
      ),
    [memberships],
  )
  const [status, setStatus] = useState<AdminAiPolicyStatus | null>(null)
  const [selectedMembershipId, setSelectedMembershipId] = useState('')
  const [selectedFactorId, setSelectedFactorId] = useState('')
  const [lectureCost, setLectureCost] = useState('0.50')
  const [dayCost, setDayCost] = useState('2.00')
  const [totpCode, setTotpCode] = useState('')
  const [pending, setPending] = useState<PendingPolicyMutation | null>(
    restorePendingPolicy,
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const awaitingTotp =
    pending?.phase === 'ready' || pending?.phase === 'control'

  useEffect(() => {
    onPendingChange(Boolean(pending))
  }, [onPendingChange, pending])

  useEffect(() => {
    setSelectedMembershipId((current) =>
      eligibleMemberships.some(
        (membership) => membership.membershipId === current,
      )
        ? current
        : (eligibleMemberships[0]?.membershipId ?? ''),
    )
  }, [eligibleMemberships])

  useEffect(() => {
    setSelectedFactorId((current) =>
      factors.some((factor) => factor.id === current)
        ? current
        : (factors[0]?.id ?? ''),
    )
  }, [factors])

  const refreshStatus = useCallback(async () => {
    const nextStatus = await getAdminAiPolicyStatus(appSessionToken)
    setStatus(nextStatus)
  }, [appSessionToken])

  useEffect(() => {
    let active = true
    refreshStatus().catch((error) => {
      if (active) setMessage(policyMessage(error))
    })
    return () => {
      active = false
    }
  }, [refreshStatus])

  function rememberPending(nextPending: PendingPolicyMutation) {
    persistPendingPolicy(nextPending)
    setPending(nextPending)
  }

  function clearPending() {
    clearStoredPendingPolicy()
    setPending(null)
    setTotpCode('')
  }

  async function commitPolicy(attempt: PendingPolicyMutation) {
    const result = await setAdminAiPolicy(
      appSessionToken,
      toPolicyRequest(attempt),
    )
    clearPending()
    await refreshStatus()
    setMessage(`講義AIの利用設定を保存しました（version ${result.version}）。`)
  }

  async function completeControl(attempt: PendingPolicyMutation) {
    if (!attempt.controlIntentDigest) {
      throw new Error('設定内容の確認を最初からやり直してください。')
    }
    await completeAdminControlStepUp(
      appSessionToken,
      'environment_ai_policy_change',
      attempt.requestId,
      attempt.controlIntentDigest,
      attempt.controlStepUpNonce,
    )
    const authorized = { ...attempt, phase: 'authorized' as const }
    rememberPending(authorized)
    await commitPolicy(authorized)
  }

  async function recoverCompleting(attempt: PendingPolicyMutation) {
    try {
      await commitPolicy({ ...attempt, phase: 'authorized' })
      return
    } catch (error) {
      if (
        !(error instanceof AdminAiUnlockError) ||
        error.code !== 'control_proof_required'
      ) {
        throw error
      }
    }
    await completeControl(attempt)
  }

  async function prepareControl(attempt: PendingPolicyMutation) {
    const factorId =
      attempt.factorId ||
      selectedFactorId ||
      (factors.length === 1 ? (factors[0]?.id ?? '') : '')
    if (!factorId) throw new Error('確認に使う認証アプリを選択してください。')
    const intent = await prepareAdminAiPolicyMutation(
      appSessionToken,
      toPolicyRequest(attempt),
    )
    const prepared = {
      ...attempt,
      controlIntentDigest: intent.controlIntentDigest,
      factorId,
      phase: 'ready' as const,
    }
    rememberPending(prepared)
    setMessage('認証アプリの6桁コードで、この設定を確認してください。')
  }

  async function beginPolicy(event: FormEvent) {
    event.preventDefault()
    const maxCostMicrousdPerLecture = dollarsToMicrousd(lectureCost, 5)
    const maxCostMicrousdPerDay = dollarsToMicrousd(dayCost, 20)
    if (!selectedMembershipId) {
      setMessage('対象の教員を選択してください。')
      return
    }
    if (
      maxCostMicrousdPerLecture === null ||
      maxCostMicrousdPerDay === null ||
      maxCostMicrousdPerDay < maxCostMicrousdPerLecture
    ) {
      setMessage(
        'コスト上限は講義0.01〜5.00 USD、1日0.01〜20.00 USDで入力してください。',
      )
      return
    }
    const request = createAdminAiPolicyMutationRequest(
      selectedMembershipId,
      maxCostMicrousdPerLecture,
      maxCostMicrousdPerDay,
    )
    const attempt: PendingPolicyMutation = {
      ...request,
      controlStepUpNonce: createAdminControlStepUpNonce(),
      phase: 'preparing',
    }
    rememberPending(attempt)
    setBusy(true)
    setMessage('設定内容を確認しています…')
    try {
      await prepareControl(attempt)
    } catch (error) {
      setMessage(policyMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function continuePending() {
    if (!pending || busy || disabled) return
    setBusy(true)
    setMessage('')
    try {
      if (pending.phase === 'preparing') {
        await prepareControl(pending)
      } else if (awaitingTotp) {
        if (!pending.factorId || !/^\d{6}$/.test(totpCode)) {
          throw new Error('認証アプリの6桁コードを入力してください。')
        }
        if (pending.phase === 'ready') {
          // The user may leave the confirmation screen open; start its bounded
          // proof only when they submit a code.
          const control = await beginAdminControlStepUp(
            appSessionToken,
            'environment_ai_policy_change',
            pending.controlIntentDigest!,
            pending.requestId,
            undefined,
            pending.controlStepUpNonce,
          )
          if (control.controlStepUpNonce !== pending.controlStepUpNonce) {
            throw new Error('設定内容の確認を最初からやり直してください。')
          }
          rememberPending({ ...pending, phase: 'control' })
        }
        const { error } = await adminSupabase.auth.mfa.challengeAndVerify({
          code: totpCode,
          factorId: pending.factorId,
        })
        if (error) throw error
        setTotpCode('')
        const completing = { ...pending, phase: 'completing' as const }
        rememberPending(completing)
        await completeControl(completing)
      } else if (pending.phase === 'completing') {
        await recoverCompleting(pending)
      } else {
        await commitPolicy(pending)
      }
    } catch (error) {
      setMessage(policyMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="admin-ai-policy-panel">
      <summary>講義AIの利用設定</summary>
      <div className="admin-ledger-form admin-ai-policy-content">
        <p className="muted">
          {status
            ? `有効な設定 ${status.coveredMembershipCount} / ${status.activeAiMembershipCount}`
            : '有効な設定を確認しています…'}
          {status?.topologyComplete && status.canonicalPolicyTopologyComplete
            ? '（全員設定済み）'
            : ''}
        </p>

        {eligibleMemberships.length > 0 && (
          <ul className="admin-ai-policy-coverage" aria-label="講義AI設定状況">
            {eligibleMemberships.map((membership) => {
              const coverage = status?.memberships.find(
                (entry) => entry.membershipId === membership.membershipId,
              )
              return (
                <li key={membership.membershipId}>
                  <span>{membershipLabel(membership)}</span>
                  <strong>{coverage?.covered ? '設定済み' : '未設定'}</strong>
                </li>
              )
            })}
          </ul>
        )}

        <p className="muted admin-ai-policy-preset">
          対象機能: 学術回答・字幕・資料解析・投票案・要約 / モデル:
          {ADMIN_AI_POLICY_PRESET.allowedModels.join('・')} /{' '}
          {ADMIN_AI_POLICY_PRESET.maxCallsPerLecture}回/講義・
          {ADMIN_AI_POLICY_PRESET.maxCallsPerDay}回/日 / 入力
          {ADMIN_AI_POLICY_PRESET.maxInputTokensPerLecture.toLocaleString(
            'ja-JP',
          )}
          /{ADMIN_AI_POLICY_PRESET.maxInputTokensPerDay.toLocaleString('ja-JP')}{' '}
          token・出力
          {ADMIN_AI_POLICY_PRESET.maxOutputTokensPerLecture.toLocaleString(
            'ja-JP',
          )}
          /
          {ADMIN_AI_POLICY_PRESET.maxOutputTokensPerDay.toLocaleString('ja-JP')}{' '}
          token / realtime {ADMIN_AI_POLICY_PRESET.maxRealtimeMinutesPerLecture}
          分/{ADMIN_AI_POLICY_PRESET.maxRealtimeMinutesPerDay}分 / 同時
          {ADMIN_AI_POLICY_PRESET.maxConcurrency}件 /{' '}
          {ADMIN_AI_POLICY_PRESET.validityDays}日間
        </p>

        {!pending ? (
          <form noValidate onSubmit={beginPolicy}>
            <label className="field">
              <span>対象の教員</span>
              <select
                disabled={disabled || busy || eligibleMemberships.length === 0}
                onChange={(event) =>
                  setSelectedMembershipId(event.target.value)
                }
                value={selectedMembershipId}
              >
                {eligibleMemberships.map((membership) => (
                  <option
                    key={membership.membershipId}
                    value={membership.membershipId}
                  >
                    {membershipLabel(membership)}
                  </option>
                ))}
              </select>
            </label>
            <div className="admin-ai-policy-costs">
              <label className="field">
                <span>講義ごとの上限（USD）</span>
                <input
                  inputMode="decimal"
                  max="5.00"
                  min="0.01"
                  onChange={(event) => setLectureCost(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={lectureCost}
                />
              </label>
              <label className="field">
                <span>1日ごとの上限（USD）</span>
                <input
                  inputMode="decimal"
                  max="20.00"
                  min="0.01"
                  onChange={(event) => setDayCost(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={dayCost}
                />
              </label>
            </div>
            <label className="field">
              <span>確認に使う認証アプリ</span>
              <select
                disabled={disabled || busy || factors.length === 0}
                onChange={(event) => setSelectedFactorId(event.target.value)}
                value={selectedFactorId}
              >
                {factors.map((factor) => (
                  <option key={factor.id} value={factor.id}>
                    {factor.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              disabled={
                disabled ||
                busy ||
                eligibleMemberships.length === 0 ||
                factors.length === 0
              }
              type="submit"
            >
              この設定で利用を許可
            </button>
          </form>
        ) : (
          <div className="admin-ai-policy-recovery">
            <p className="muted">
              同じ request ID と設定内容で安全に再開します。
            </p>
            {awaitingTotp && (
              <label className="field">
                <span>6桁コード</span>
                <input
                  autoComplete="one-time-code"
                  disabled={busy}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) =>
                    setTotpCode(
                      event.target.value.replace(/\D/g, '').slice(0, 6),
                    )
                  }
                  value={totpCode}
                />
              </label>
            )}
            <div className="admin-ai-policy-actions">
              <button
                className="primary-button"
                disabled={disabled || busy}
                onClick={() => void continuePending()}
                type="button"
              >
                {awaitingTotp ? '認証アプリで確認' : '同じ内容で再試行'}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  clearPending()
                  setMessage('保留中の設定を取り消しました。')
                }}
                type="button"
              >
                保留中の設定を取り消す
              </button>
            </div>
          </div>
        )}

        {message && <p className="admin-ledger-message">{message}</p>}
      </div>
    </details>
  )
}
