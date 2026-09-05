import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import type { AdminOperationCredential } from '../lib/adminAuth/adminOperationCredential'
import { isPhase730AdminAiUnlockEnabled } from '../lib/featureFlags'
import {
  AdminLedgerError,
  commitAdminLedgerMutation,
  getAdminLedgerAudit,
  getAdminLedgerSnapshot,
  prepareAdminLedgerMutation,
  type AdminLedgerAuditEvent,
  type AdminLedgerMutationIntent,
  type AdminLedgerMutationAction,
  type AdminLedgerMutationRequest,
  type AdminLedgerSnapshot,
} from '../lib/adminAuth/adminLedgerApi'
import {
  ADMIN_AI_POLICY_PENDING_STORAGE_KEY,
  ADMIN_LEDGER_PENDING_STORAGE_KEY,
} from '../lib/adminAuth/adminAuthStorage'
import {
  AdminIdentityError,
  beginAdminControlStepUp,
  completeAdminControlStepUp,
  createAdminControlStepUpNonce,
} from '../lib/adminAuth/adminIdentityApi'
import { adminSupabase } from '../lib/adminAuth/adminSupabaseClient'
import {
  supabaseAdminRepository,
  type AdminLecture,
} from '../repositories/supabaseAdminRepository'
import { AdminAiPolicyPanel } from './AdminAiPolicyPanel'
import type { AdminAiPolicyStatus } from '../lib/adminAuth/adminAiUnlockApi'
import { AdminAiBudgetFields } from './AdminAiBudgetFields'
import {
  DEFAULT_AI_DAY_COST,
  DEFAULT_AI_LECTURE_COST,
  dollarsToMicrousd,
} from '../lib/adminAuth/adminAiBudget'

type PendingMutation = AdminLedgerMutationRequest & {
  controlStepUpNonce: string
  factorId?: string
  intent?: AdminLedgerMutationIntent
  phase: 'authorized' | 'completing' | 'control' | 'preparing' | 'ready'
  requestId: string
}

type FactorOption = { id: string; label: string }

const MUTATION_LABELS = {
  demoteOwner: '管理者権限を解除',
  disableAi: 'AI利用を停止',
  enableAi: 'AI利用を許可',
  globalRevoke: '教員の全セッションを失効',
  issueInvitation: '招待リンクを作成',
  promoteOwner: '管理者権限を付与',
  reactivateMembership: '教員権限を再開',
  revokeInvitation: '招待を取り消し',
  revokeMembership: '教員権限を抹消',
  revokeSession: 'ログインを失効',
  suspendMembership: '教員権限を一時停止',
} satisfies Record<AdminLedgerMutationAction, string>

const INVITATION_LIFETIME_MS = 48 * 60 * 60 * 1_000

const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  active: '利用中',
  pending_mfa: '認証アプリ登録待ち',
  revoked: '失効済み',
  suspended: '一時停止中',
}

const INVITATION_STATUS_LABELS: Record<string, string> = {
  accepted: '受諾済み',
  expired: '期限切れ',
  pending: '受諾待ち',
  revoked: '取消済み',
}

const LECTURE_STATUS_LABELS: Record<string, string> = {
  archived: '保存済み',
  closed: '終了',
  open: '進行中',
}

const AUDIT_RESULT_LABELS: Record<string, string> = {
  accepted: '完了',
  denied: '拒否',
  failed: '失敗',
}

function clearStoredPendingMutation() {
  try {
    window.sessionStorage.removeItem(ADMIN_LEDGER_PENDING_STORAGE_KEY)
  } catch {
    // Recovery storage must never block a safe control operation.
  }
}

function persistPendingMutation(pending: PendingMutation) {
  try {
    window.sessionStorage.setItem(
      ADMIN_LEDGER_PENDING_STORAGE_KEY,
      JSON.stringify({ createdAt: Date.now(), pending }),
    )
  } catch {
    // The database request remains exact even when browser recovery is absent.
  }
}

function restorePendingMutation(): PendingMutation | null {
  try {
    const raw = window.sessionStorage.getItem(ADMIN_LEDGER_PENDING_STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as {
      createdAt?: unknown
      pending?: Record<string, unknown>
    }
    const pending = stored.pending
    const phase = String(pending?.phase)
    const intent = pending?.intent as Record<string, unknown> | undefined
    if (
      typeof stored.createdAt !== 'number' ||
      !Number.isSafeInteger(stored.createdAt) ||
      stored.createdAt > Date.now() ||
      Date.now() - stored.createdAt > 24 * 60 * 60 * 1_000 ||
      !pending ||
      typeof pending.action !== 'string' ||
      !(pending.action in MUTATION_LABELS) ||
      !pending.payload ||
      typeof pending.payload !== 'object' ||
      typeof pending.controlStepUpNonce !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(pending.controlStepUpNonce) ||
      typeof pending.requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(pending.requestId) ||
      !['authorized', 'completing', 'control', 'preparing', 'ready'].includes(
        phase,
      ) ||
      (phase !== 'preparing' &&
        (typeof pending.factorId !== 'string' ||
          !/^[0-9a-f-]{36}$/i.test(pending.factorId) ||
          !intent ||
          typeof intent.intentDigest !== 'string' ||
          !/^[0-9a-f]{64}$/.test(intent.intentDigest) ||
          intent.requestId !== pending.requestId ||
          intent.operationKey !==
            `manage-admin-ledger.${String(pending.action)}`))
    ) {
      throw new Error('invalid pending Admin ledger operation')
    }
    return pending as PendingMutation
  } catch {
    clearStoredPendingMutation()
    return null
  }
}

function safeMessage(error: unknown) {
  if (error instanceof AdminLedgerError) return error.message
  return error instanceof Error
    ? error.message
    : '教員管理の操作を完了できませんでした。'
}

function isRejectedTotpCode(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'mfa_verification_failed'
  )
}

function pendingRecoveryMessage(
  error: unknown,
  phase: PendingMutation['phase'],
) {
  if (phase === 'control') {
    return isRejectedTotpCode(error)
      ? '認証コードを確認できませんでした。新しい6桁コードを入力して、もう一度実行してください。'
      : '認証サービスとの通信に失敗しました。コードの正誤は確認されていません。通信状態を確認して、もう一度実行してください。'
  }
  const identityConfirmed = phase === 'completing' || phase === 'authorized'
  if (
    identityConfirmed &&
    (error instanceof AdminIdentityError || error instanceof AdminLedgerError)
  ) {
    if (error.code === 'service_unavailable') {
      return '通信が一時的に失敗しました。本人確認は完了しています。'
    }
    if (error.code === 'rate_limited') {
      return '操作が集中しています。少し待ってから続けてください。本人確認は完了しています。'
    }
  }
  return safeMessage(error)
}

export function AdminLedgerPanel({
  adminCredential,
  appSessionToken,
  clientAdmissionEnabled,
  onReloginRequired,
}: {
  adminCredential: AdminOperationCredential
  appSessionToken: string
  clientAdmissionEnabled: boolean
  onReloginRequired: () => Promise<void>
}) {
  const [snapshot, setSnapshot] = useState<AdminLedgerSnapshot | null>(null)
  const [auditEvents, setAuditEvents] = useState<AdminLedgerAuditEvent[]>([])
  const [lectures, setLectures] = useState<AdminLecture[]>([])
  const [factors, setFactors] = useState<FactorOption[]>([])
  const [selectedFactorId, setSelectedFactorId] = useState('')
  const [pending, setPending] = useState<PendingMutation | null>(
    restorePendingMutation,
  )
  const [policyPending, setPolicyPending] = useState(() => {
    try {
      return Boolean(
        window.sessionStorage.getItem(ADMIN_AI_POLICY_PENDING_STORAGE_KEY),
      )
    } catch {
      return false
    }
  })
  const [totpCode, setTotpCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [invitationLink, setInvitationLink] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteCanUseAi, setInviteCanUseAi] = useState(false)
  const [inviteLectureCost, setInviteLectureCost] = useState(
    DEFAULT_AI_LECTURE_COST,
  )
  const [inviteDayCost, setInviteDayCost] = useState(DEFAULT_AI_DAY_COST)
  const [aiPolicyStatus, setAiPolicyStatus] =
    useState<AdminAiPolicyStatus | null>(null)
  const [aiPolicySelection, setAiPolicySelection] = useState<{
    membershipId: string
  } | null>(null)
  const invitationFormRef = useRef<HTMLDetailsElement>(null)

  const pendingConfirmationRef = useRef<HTMLFormElement>(null)
  const awaitingTotp =
    pending?.phase === 'ready' || pending?.phase === 'control'
  const pendingInvitationsForInviteEmail = useMemo(() => {
    const normalizedEmail = inviteEmail.trim().toLowerCase()
    if (!normalizedEmail || !snapshot) return []
    return snapshot.invitations.filter(
      (invitation) =>
        invitation.status === 'pending' &&
        invitation.normalizedEmail === normalizedEmail,
    )
  }, [inviteEmail, snapshot])
  const pendingInvitationForInviteEmail =
    pendingInvitationsForInviteEmail.length === 1
      ? pendingInvitationsForInviteEmail[0]
      : null

  const admissionEnabled = Boolean(
    clientAdmissionEnabled && snapshot?.ledgerAdmissionEnabled,
  )

  function rememberPendingMutation(nextPending: PendingMutation) {
    persistPendingMutation(nextPending)
    setPending(nextPending)
  }

  function clearPendingMutation() {
    clearStoredPendingMutation()
    setPending(null)
  }

  const refresh = useCallback(async () => {
    const [nextSnapshot, nextAudit, nextLectures, factorResult] =
      await Promise.all([
        getAdminLedgerSnapshot(adminCredential),
        getAdminLedgerAudit(adminCredential),
        supabaseAdminRepository
          .manageLectures({ action: 'list', adminToken: adminCredential })
          .catch(() => []),
        adminSupabase.auth.mfa.listFactors(),
      ])
    if (factorResult.error) throw factorResult.error
    const nextFactors = factorResult.data.totp
      .filter((factor) => factor.status === 'verified')
      .map((factor) => ({
        id: factor.id,
        label:
          (
            factor as typeof factor & { friendly_name?: string }
          ).friendly_name?.trim() || `認証アプリ …${factor.id.slice(-6)}`,
      }))
    setSnapshot(nextSnapshot)
    setAuditEvents(nextAudit)
    setLectures(nextLectures)
    setFactors(nextFactors)
    setSelectedFactorId((current) =>
      nextFactors.some((factor) => factor.id === current)
        ? current
        : (nextFactors[0]?.id ?? ''),
    )
  }, [adminCredential])

  useEffect(() => {
    let active = true
    setBusy(true)
    refresh()
      .catch((error) => {
        if (active) setMessage(safeMessage(error))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [refresh])

  useEffect(() => {
    if (!pending || busy) return
    const frame = window.requestAnimationFrame(() => {
      const form = pendingConfirmationRef.current
      if (!form) return
      form.scrollIntoView({ behavior: 'instant', block: 'nearest' })
      const nextControl = awaitingTotp
        ? form.querySelector<HTMLInputElement>(
            'input[autocomplete="one-time-code"]',
          )
        : form.querySelector<HTMLButtonElement>(
            'button.primary-button:not(:disabled)',
          )
      nextControl?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [awaitingTotp, busy, pending])

  async function preparePending(attempt: PendingMutation) {
    setBusy(true)
    setMessage('')
    try {
      const factorId =
        attempt.factorId ||
        selectedFactorId ||
        (factors.length === 1 ? (factors[0]?.id ?? '') : '')
      if (!factorId) throw new Error('確認に使う認証アプリを選択してください。')
      const intent =
        attempt.intent ??
        (await prepareAdminLedgerMutation({
          action: attempt.action,
          adminToken: adminCredential,
          payload: attempt.payload,
          requestId: attempt.requestId,
        } as Parameters<typeof prepareAdminLedgerMutation>[0]))
      rememberPendingMutation({
        ...attempt,
        factorId,
        intent,
        phase: 'ready',
      })
      setTotpCode('')
    } catch (error) {
      rememberPendingMutation(attempt)
      setMessage(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function startMutation(request: AdminLedgerMutationRequest) {
    if (busy || pending || policyPending) return
    const attempt: PendingMutation = {
      ...request,
      controlStepUpNonce: createAdminControlStepUpNonce(),
      phase: 'preparing',
      requestId: crypto.randomUUID(),
    }
    rememberPendingMutation(attempt)
    void preparePending(attempt)
  }

  async function finishPending(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (
      !pending ||
      busy ||
      policyPending ||
      !pending.intent ||
      !pending.factorId
    )
      return
    if (awaitingTotp && !/^\d{6}$/.test(totpCode)) return
    let recoveryPhase = pending.phase
    setBusy(true)
    setMessage('')
    try {
      let nextPending: PendingMutation & {
        factorId: string
        intent: AdminLedgerMutationIntent
      } = {
        ...pending,
        factorId: pending.factorId,
        intent: pending.intent,
      }
      if (nextPending.phase === 'ready') {
        // Bind the five-minute proof immediately before verifying the submitted
        // code, not while the user is reading or waiting on this screen.
        await beginAdminControlStepUp(
          appSessionToken,
          nextPending.intent.controlStepUpAction,
          nextPending.intent.intentDigest,
          nextPending.requestId,
          nextPending.intent.operationKey,
          nextPending.controlStepUpNonce,
        )
        nextPending = { ...nextPending, phase: 'control' }
        recoveryPhase = 'control'
        rememberPendingMutation(nextPending)
      }
      if (nextPending.phase === 'control') {
        const { error } = await adminSupabase.auth.mfa.challengeAndVerify({
          code: totpCode,
          factorId: nextPending.factorId,
        })
        if (error) throw error
        nextPending = { ...nextPending, phase: 'completing' }
        recoveryPhase = 'completing'
        rememberPendingMutation(nextPending)
        setTotpCode('')
      }
      if (nextPending.phase === 'completing') {
        await completeAdminControlStepUp(
          appSessionToken,
          nextPending.intent.controlStepUpAction,
          nextPending.requestId,
          nextPending.intent.intentDigest,
          nextPending.controlStepUpNonce,
          nextPending.intent.operationKey,
        )
        nextPending = { ...nextPending, phase: 'authorized' }
        recoveryPhase = 'authorized'
        rememberPendingMutation(nextPending)
      }
      const result = await commitAdminLedgerMutation({
        action: nextPending.action,
        adminToken: adminCredential,
        intentDigest: nextPending.intent.intentDigest,
        payload: nextPending.payload,
        requestId: nextPending.requestId,
      } as Parameters<typeof commitAdminLedgerMutation>[0])

      if (nextPending.action === 'issueInvitation' && result.invitationToken) {
        setInvitationLink(
          `${window.location.origin}/admin#invite=${result.invitationToken}`,
        )
      }
      const currentMembershipChanged =
        'membershipId' in nextPending.payload &&
        nextPending.payload.membershipId === snapshot?.currentMembershipId &&
        ['demoteOwner', 'revokeMembership', 'suspendMembership'].includes(
          nextPending.action,
        )
      const currentSessionRevoked =
        nextPending.action === 'revokeSession' &&
        nextPending.payload.sessionId === snapshot?.currentSessionId

      clearPendingMutation()
      setMessage(
        nextPending.action === 'issueInvitation'
          ? '招待リンクを作成しました。リンクを教員へ共有してください。メールは自動送信されません。'
          : nextPending.action === 'enableAi' && nextPending.payload.aiPolicy
            ? 'AI権限と利用上限を設定しました。'
            : '教員情報を更新しました。',
      )
      if (currentMembershipChanged || currentSessionRevoked) {
        await onReloginRequired()
        return
      }
      await refresh()
    } catch (error) {
      if (recoveryPhase === 'control' && isRejectedTotpCode(error)) {
        setTotpCode('')
      }
      if (
        error instanceof AdminIdentityError &&
        error.code === 'step_up_invalid'
      ) {
        clearPendingMutation()
        setTotpCode('')
        setMessage(
          '確認時間が終了しました。操作をもう一度開始し、新しい6桁コードで確認してください。',
        )
        return
      } else if (
        error instanceof AdminLedgerError &&
        ['invitation_pending', 'state_changed'].includes(error.code)
      ) {
        clearPendingMutation()
        await refresh().catch(() => undefined)
      } else if (
        error instanceof AdminLedgerError &&
        !['rate_limited', 'service_unavailable'].includes(error.code)
      ) {
        clearPendingMutation()
      }
      setMessage(pendingRecoveryMessage(error, recoveryPhase))
    } finally {
      setBusy(false)
    }
  }

  async function loadOlderAudit() {
    const last = auditEvents.at(-1)
    if (!last || busy) return
    setBusy(true)
    try {
      const next = await getAdminLedgerAudit(
        adminCredential,
        { beforeAt: last.occurredAt, beforeId: last.eventId },
        50,
      )
      setAuditEvents((current) => [...current, ...next])
    } catch (error) {
      setMessage(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function stopLecture(lectureSessionId: string) {
    if (busy || pending || policyPending) return
    if (
      !window.confirm(
        'この講義を終了します。学生の同期と書き込みが停止します。よろしいですか？',
      )
    ) {
      return
    }

    setBusy(true)
    setMessage('')
    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action: 'emergencyStop',
        adminToken: adminCredential,
        lectureSessionId,
      })
      setLectures(nextLectures)
      setMessage('講義を終了しました。')
      await refresh()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `講義を終了できませんでした: ${error.message}`
          : '講義を終了できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  const sessionsByMembership = useMemo(() => {
    const result = new Map<string, AdminLedgerSnapshot['sessions']>()
    for (const session of snapshot?.sessions ?? []) {
      const current = result.get(session.membershipId) ?? []
      current.push(session)
      result.set(session.membershipId, current)
    }
    return result
  }, [snapshot])

  const activeLectureOwnerships = useMemo(
    () =>
      snapshot?.ownerships.filter(
        (ownership) => ownership.lectureStatus === 'open',
      ) ?? [],
    [snapshot],
  )
  const lectureTitlesById = useMemo(
    () => new Map(lectures.map((lecture) => [lecture.id, lecture.title])),
    [lectures],
  )
  const reviewEvents = useMemo(
    () =>
      auditEvents.filter((event) =>
        ['denied', 'failed'].includes(event.result),
      ),
    [auditEvents],
  )
  const mutationBlocked = Boolean(pending) || policyPending

  if (!snapshot) {
    return (
      <section className="admin-ledger-panel" aria-busy={busy}>
        <h2>教員一覧</h2>
        <p>{message || '教員情報を読み込んでいます…'}</p>
      </section>
    )
  }

  return (
    <section className="admin-ledger-panel" aria-busy={busy}>
      <div className="admin-ledger-heading">
        <h2>教員一覧</h2>
        <button
          className="primary-button"
          disabled={busy || mutationBlocked || !admissionEnabled}
          onClick={() => {
            const form = invitationFormRef.current
            if (!form) return
            form.open = true
            form.scrollIntoView({ behavior: 'instant', block: 'nearest' })
            form
              .querySelector<HTMLInputElement>('input[type="email"]')
              ?.focus({ preventScroll: true })
          }}
          type="button"
        >
          新しい教員を追加
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void refresh().catch((error) => setMessage(safeMessage(error)))
          }
          type="button"
        >
          最新状態を確認
        </button>
      </div>

      {!admissionEnabled ? (
        <p className="helper-note">
          新しい教員の招待は停止中です。権限停止とログイン失効は利用できます。
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}

      <dl className="admin-ledger-overview" aria-label="運用状況">
        <div>
          <dt>有効な教員</dt>
          <dd>
            {
              snapshot.memberships.filter(
                (membership) => membership.status === 'active',
              ).length
            }
          </dd>
        </div>
        <div>
          <dt>ログイン中</dt>
          <dd>
            {
              snapshot.sessions.filter((session) => session.status === 'active')
                .length
            }
          </dd>
        </div>
        <div>
          <dt>進行中の講義</dt>
          <dd>{activeLectureOwnerships.length}</dd>
        </div>
        <div className={reviewEvents.length > 0 ? 'needs-review' : undefined}>
          <dt>要確認</dt>
          <dd>{reviewEvents.length}</dd>
        </div>
      </dl>

      {isPhase730AdminAiUnlockEnabled ? (
        <AdminAiPolicyPanel
          appSessionToken={appSessionToken}
          disabled={busy || Boolean(pending)}
          factors={factors}
          memberships={snapshot.memberships}
          onEnableAi={(membership, aiPolicy) =>
            startMutation({
              action: 'enableAi',
              payload: {
                aiPolicy,
                expectedCanUseAi: false,
                expectedStatus: 'active',
                expectedUpdatedAt: membership.updatedAt,
                membershipId: membership.membershipId,
              },
            })
          }
          onPendingChange={setPolicyPending}
          onStatusChange={setAiPolicyStatus}
          selection={aiPolicySelection}
        />
      ) : null}

      {pending ? (
        <form
          aria-describedby="admin-ledger-confirmation-instruction"
          aria-labelledby="admin-ledger-confirmation-title"
          className="admin-ledger-confirmation"
          onSubmit={finishPending}
          ref={pendingConfirmationRef}
        >
          <h3 id="admin-ledger-confirmation-title">
            {pending.phase === 'preparing'
              ? busy
                ? '変更を準備しています'
                : '変更を準備できませんでした'
              : awaitingTotp
                ? busy
                  ? '変更を確認しています'
                  : '変更を確認'
                : pending.phase === 'completing'
                  ? busy
                    ? '本人確認が完了しました'
                    : '本人確認は完了しています'
                  : busy
                    ? '変更を反映しています'
                    : '変更の承認は完了しています'}
          </h3>
          <p>{MUTATION_LABELS[pending.action]}</p>
          <p className="helper-note" id="admin-ledger-confirmation-instruction">
            {pending.phase === 'preparing'
              ? busy
                ? 'そのままお待ちください。'
                : '通信を確認して、もう一度準備してください。'
              : awaitingTotp
                ? busy
                  ? '認証アプリのコードを確認しています。'
                  : '認証アプリの6桁コードを入力してください。'
                : pending.phase === 'completing'
                  ? busy
                    ? '変更を処理しています。'
                    : '6桁コードの再入力は不要です。処理を続けてください。'
                  : busy
                    ? 'そのままお待ちください。'
                    : '6桁コードの再入力は不要です。反映結果を確認してください。'}
          </p>
          {pending.phase === 'preparing' ? (
            busy ? null : (
              <button
                className="secondary-button"
                onClick={() => void preparePending(pending)}
                type="button"
              >
                準備を再試行
              </button>
            )
          ) : awaitingTotp ? (
            <>
              {'aiPolicy' in pending.payload && pending.payload.aiPolicy && (
                <p>
                  AI利用：1講義 $
                  {(
                    pending.payload.aiPolicy.maxCostMicrousdPerLecture /
                    1_000_000
                  ).toFixed(2)}
                  {' / '}1日 $
                  {(
                    pending.payload.aiPolicy.maxCostMicrousdPerDay / 1_000_000
                  ).toFixed(2)}
                  ・30日間
                </p>
              )}
              <label className="field">
                <span>確認に使う認証アプリ</span>
                <select
                  disabled={busy}
                  onChange={(event) =>
                    setPending((current) =>
                      current
                        ? { ...current, factorId: event.target.value }
                        : current,
                    )
                  }
                  value={pending.factorId}
                >
                  {factors.map((factor) => (
                    <option key={factor.id} value={factor.id}>
                      {factor.label}
                    </option>
                  ))}
                </select>
              </label>
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
              {busy ? null : (
                <button
                  className="primary-button"
                  disabled={totpCode.length !== 6}
                  type="submit"
                >
                  この変更を実行
                </button>
              )}
            </>
          ) : pending.phase === 'completing' ? (
            busy ? null : (
              <button
                className="primary-button"
                onClick={() => void finishPending()}
                type="button"
              >
                認証済みの処理を続ける
              </button>
            )
          ) : busy ? null : (
            <button
              className="primary-button"
              onClick={() => void finishPending()}
              type="button"
            >
              変更の完了を確認する
            </button>
          )}
          {!busy && (pending.phase === 'preparing' || awaitingTotp) ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                clearPendingMutation()
                setTotpCode('')
              }}
              type="button"
            >
              キャンセル
            </button>
          ) : null}
        </form>
      ) : null}

      <section className="admin-ledger-members" aria-label="教員一覧">
        <div className="admin-ledger-table-wrap">
          <table className="admin-ledger-table">
            <thead>
              <tr>
                <th scope="col">教員</th>
                <th scope="col">権限</th>
                <th scope="col">状態</th>
                <th scope="col">AI利用</th>
                <th scope="col">ログイン</th>
                <th scope="col">権限・停止</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.memberships.map((membership) => {
                const activeSessions = (
                  sessionsByMembership.get(membership.membershipId) ?? []
                ).filter((session) => session.status === 'active')
                const permissionLabel =
                  membership.role === 'owner'
                    ? '管理者（全権限付与）'
                    : membership.canUseAi
                      ? '教員（AI利用可）'
                      : '教員（AI利用不可）'
                const policyCoverage = aiPolicyStatus?.memberships.find(
                  (entry) => entry.membershipId === membership.membershipId,
                )

                return (
                  <tr key={membership.membershipId}>
                    <td data-label="教員">
                      <strong>
                        {membership.displayName || membership.normalizedEmail}
                      </strong>
                      <small>{membership.normalizedEmail}</small>
                    </td>
                    <td data-label="権限">{permissionLabel}</td>
                    <td data-label="状態">
                      {MEMBERSHIP_STATUS_LABELS[membership.status] ??
                        '状態確認中'}
                    </td>
                    <td data-label="AI利用">
                      <span>
                        {membership.status !== 'active'
                          ? '利用不可'
                          : !membership.canUseAi
                            ? '許可なし'
                            : !aiPolicyStatus
                              ? '確認中'
                              : policyCoverage?.covered
                                ? '設定済み'
                                : '上限未設定'}
                      </span>
                      {policyCoverage?.covered && (
                        <small>
                          $
                          {(
                            policyCoverage.maxCostMicrousdPerLecture! /
                            1_000_000
                          ).toFixed(2)}
                          /講義
                          {' · '}$
                          {(
                            policyCoverage.maxCostMicrousdPerDay! / 1_000_000
                          ).toFixed(2)}
                          /日
                        </small>
                      )}
                      {isPhase730AdminAiUnlockEnabled &&
                        membership.status === 'active' && (
                          <button
                            disabled={
                              busy || mutationBlocked || !admissionEnabled
                            }
                            onClick={() =>
                              setAiPolicySelection({
                                membershipId: membership.membershipId,
                              })
                            }
                            type="button"
                          >
                            AI利用を設定
                          </button>
                        )}
                    </td>
                    <td data-label="ログイン">
                      <span>{activeSessions.length}件</span>
                      {activeSessions.map((session) => (
                        <div
                          className="admin-ledger-session"
                          key={session.sessionId}
                        >
                          <span>
                            {session.isCurrent
                              ? '現在のセッション'
                              : '別のセッション'}{' '}
                            /{' '}
                            {new Date(session.lastSeenAt).toLocaleString(
                              'ja-JP',
                            )}
                          </span>
                          <button
                            disabled={busy || mutationBlocked}
                            onClick={() =>
                              startMutation({
                                action: 'revokeSession',
                                payload: {
                                  membershipId: membership.membershipId,
                                  sessionId: session.sessionId,
                                },
                              })
                            }
                            type="button"
                          >
                            このログインを失効
                          </button>
                        </div>
                      ))}
                    </td>
                    <td data-label="権限・停止">
                      <details className="admin-ledger-row-actions">
                        <summary>操作</summary>
                        <div className="admin-ledger-actions">
                          {membership.status === 'active' &&
                          membership.role === 'owner' ? (
                            <button
                              disabled={busy || mutationBlocked}
                              onClick={() =>
                                startMutation({
                                  action: 'demoteOwner',
                                  payload: {
                                    expectedRole: 'owner',
                                    expectedStatus: 'active',
                                    expectedUpdatedAt: membership.updatedAt,
                                    membershipExpiresAt: null,
                                    membershipId: membership.membershipId,
                                    reasonCode: 'owner_demotion',
                                  },
                                })
                              }
                              type="button"
                            >
                              管理者権限を解除
                            </button>
                          ) : null}
                          {membership.status === 'active' &&
                          membership.role === 'instructor' &&
                          membership.canUseAi ? (
                            <button
                              disabled={busy || mutationBlocked}
                              onClick={() =>
                                startMutation({
                                  action: 'disableAi',
                                  payload: {
                                    expectedCanUseAi: true,
                                    expectedStatus: 'active',
                                    expectedUpdatedAt: membership.updatedAt,
                                    membershipId: membership.membershipId,
                                  },
                                })
                              }
                              type="button"
                            >
                              AI利用を停止
                            </button>
                          ) : null}
                          {membership.status === 'active' &&
                          membership.role === 'instructor' &&
                          !membership.canUseAi ? (
                            <button
                              disabled={
                                busy || mutationBlocked || !admissionEnabled
                              }
                              onClick={() =>
                                setAiPolicySelection({
                                  membershipId: membership.membershipId,
                                })
                              }
                              type="button"
                            >
                              AI利用を許可
                            </button>
                          ) : null}
                          {membership.status === 'active' ? (
                            <button
                              disabled={busy || mutationBlocked}
                              onClick={() =>
                                startMutation({
                                  action: 'suspendMembership',
                                  payload: {
                                    expectedStatus: 'active',
                                    expectedUpdatedAt: membership.updatedAt,
                                    membershipId: membership.membershipId,
                                    reasonCode: 'owner_suspension',
                                  },
                                })
                              }
                              type="button"
                            >
                              教員権限を一時停止
                            </button>
                          ) : null}
                          {membership.status === 'suspended' ? (
                            <button
                              disabled={
                                busy || mutationBlocked || !admissionEnabled
                              }
                              onClick={() =>
                                startMutation({
                                  action: 'reactivateMembership',
                                  payload: {
                                    expectedStatus: 'suspended',
                                    expectedUpdatedAt: membership.updatedAt,
                                    membershipId: membership.membershipId,
                                  },
                                })
                              }
                              type="button"
                            >
                              教員権限を再開
                            </button>
                          ) : null}
                          {membership.status !== 'revoked' ? (
                            <button
                              disabled={busy || mutationBlocked}
                              onClick={() =>
                                startMutation({
                                  action: 'revokeMembership',
                                  payload: {
                                    expectedStatus: membership.status as
                                      'active' | 'pending_mfa' | 'suspended',
                                    expectedUpdatedAt: membership.updatedAt,
                                    membershipId: membership.membershipId,
                                    reasonCode: 'owner_revocation',
                                  },
                                })
                              }
                              type="button"
                            >
                              教員権限を抹消
                            </button>
                          ) : null}
                          {membership.membershipId !==
                          snapshot.currentMembershipId ? (
                            <button
                              disabled={busy || mutationBlocked}
                              onClick={() =>
                                startMutation({
                                  action: 'globalRevoke',
                                  payload: {
                                    membershipId: membership.membershipId,
                                  },
                                })
                              }
                              type="button"
                            >
                              全ログインを失効
                            </button>
                          ) : null}
                        </div>
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <details
        className="admin-ledger-add-teacher"
        open={invitationLink ? true : undefined}
        ref={invitationFormRef}
      >
        <summary>教員を追加</summary>
        <form
          className="admin-ledger-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (
              !admissionEnabled ||
              pendingInvitationsForInviteEmail.length > 0
            )
              return
            const maxCostMicrousdPerLecture = dollarsToMicrousd(
              inviteLectureCost,
              5,
            )
            const maxCostMicrousdPerDay = dollarsToMicrousd(inviteDayCost, 20)
            if (
              inviteCanUseAi &&
              (maxCostMicrousdPerLecture === null ||
                maxCostMicrousdPerDay === null ||
                maxCostMicrousdPerDay < maxCostMicrousdPerLecture)
            ) {
              setMessage(
                'AI上限を確認してください。1日の上限は講義ごとの上限以上にしてください。',
              )
              return
            }
            startMutation({
              action: 'issueInvitation',
              payload: {
                canUseAi: inviteCanUseAi,
                ...(inviteCanUseAi
                  ? {
                      aiPolicy: {
                        maxCostMicrousdPerDay: maxCostMicrousdPerDay!,
                        maxCostMicrousdPerLecture: maxCostMicrousdPerLecture!,
                        validityDays: 30 as const,
                      },
                    }
                  : {}),
                expiresAt: new Date(
                  Date.now() + INVITATION_LIFETIME_MS,
                ).toISOString(),
                membershipExpiresAt: null,
                normalizedEmail: inviteEmail.trim().toLowerCase(),
                role: 'instructor',
              },
            })
          }}
        >
          <label className="field">
            <span>Googleアカウントのメールアドレス</span>
            <input
              autoComplete="email"
              onChange={(event) => setInviteEmail(event.target.value)}
              required
              type="email"
              value={inviteEmail}
            />
          </label>
          <label className="field admin-ledger-checkbox">
            <input
              checked={inviteCanUseAi}
              onChange={(event) => setInviteCanUseAi(event.target.checked)}
              type="checkbox"
            />
            <span>AI利用を許可</span>
          </label>
          {inviteCanUseAi && (
            <>
              <AdminAiBudgetFields
                dayCost={inviteDayCost}
                disabled={busy || mutationBlocked}
                lectureCost={inviteLectureCost}
                onDayCostChange={setInviteDayCost}
                onLectureCostChange={setInviteLectureCost}
              />
              <p className="helper-note">
                招待受諾時から30日間有効です。AI権限と上限をまとめて設定します。
              </p>
            </>
          )}
          <p className="helper-note">招待リンクは作成から48時間有効です。</p>
          {pendingInvitationsForInviteEmail.length > 1 ? (
            <p className="helper-note" role="alert">
              招待状態を確認できません。新しい招待を作成せず、最新状態を確認してください。
            </p>
          ) : pendingInvitationForInviteEmail ? (
            <div className="admin-ledger-existing-invitation">
              <p className="helper-note" role="status">
                この教員には受諾待ちの招待があります。
              </p>
              <button
                className="secondary-button"
                disabled={busy || mutationBlocked}
                onClick={() =>
                  startMutation({
                    action: 'revokeInvitation',
                    payload: {
                      expectedStatus: 'pending',
                      expectedUpdatedAt:
                        pendingInvitationForInviteEmail.updatedAt,
                      invitationId:
                        pendingInvitationForInviteEmail.invitationId,
                    },
                  })
                }
                type="button"
              >
                この招待を取り消す
              </button>
            </div>
          ) : null}
          <button
            className="primary-button"
            disabled={
              busy ||
              mutationBlocked ||
              !admissionEnabled ||
              pendingInvitationsForInviteEmail.length > 0
            }
            type="submit"
          >
            招待リンクを作成
          </button>
        </form>
        {invitationLink ? (
          <div className="admin-ledger-invitation-link">
            <label className="field">
              <span>今回だけ表示される招待リンク</span>
              <input readOnly value={invitationLink} />
            </label>
            <button
              className="secondary-button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(invitationLink)
                  .then(() => setMessage('招待リンクをコピーしました。'))
                  .catch(() =>
                    setMessage('招待リンクをコピーできませんでした。'),
                  )
              }
              type="button"
            >
              リンクをコピー
            </button>
          </div>
        ) : null}
      </details>

      <section
        aria-labelledby="admin-ledger-active-lectures-title"
        className="admin-ledger-monitor-section"
      >
        <div className="admin-ledger-section-heading">
          <h3 id="admin-ledger-active-lectures-title">進行中の講義</h3>
          <span>{activeLectureOwnerships.length}</span>
        </div>
        <div className="admin-ledger-list">
          {activeLectureOwnerships.map((ownership) => (
            <article
              className="admin-ledger-card admin-ledger-lecture"
              key={ownership.lectureSessionId}
            >
              <strong>
                {lectureTitlesById.get(ownership.lectureSessionId) ??
                  `講義 ${ownership.lectureSessionId.slice(0, 8)}`}
              </strong>
              <span>
                {LECTURE_STATUS_LABELS[ownership.lectureStatus] ?? '状態確認中'}
              </span>
              <button
                className="danger-button"
                disabled={busy || mutationBlocked}
                onClick={() => void stopLecture(ownership.lectureSessionId)}
                type="button"
              >
                講義を停止
              </button>
            </article>
          ))}
          {activeLectureOwnerships.length === 0 ? (
            <p className="note">進行中の講義はありません。</p>
          ) : null}
        </div>
      </section>

      <section
        aria-labelledby="admin-ledger-review-title"
        className={`admin-ledger-monitor-section admin-ledger-review${
          reviewEvents.length > 0 ? ' needs-review' : ''
        }`}
      >
        <div className="admin-ledger-section-heading">
          <h3 id="admin-ledger-review-title">要確認</h3>
          <span>{reviewEvents.length}</span>
        </div>
        {reviewEvents.length === 0 ? (
          <p className="note">拒否・失敗した操作はありません。</p>
        ) : (
          <ol className="admin-ledger-audit">
            {reviewEvents.slice(0, 5).map((event) => (
              <li key={event.eventId}>
                <strong>
                  {event.action.startsWith('admin_ledger.')
                    ? (MUTATION_LABELS[
                        event.action.slice(
                          'admin_ledger.'.length,
                        ) as AdminLedgerMutationAction
                      ] ?? '管理操作')
                    : '認証・権限操作'}
                </strong>{' '}
                / {AUDIT_RESULT_LABELS[event.result] ?? '記録済み'} /{' '}
                {new Date(event.occurredAt).toLocaleString('ja-JP')}
              </li>
            ))}
          </ol>
        )}
      </section>

      <details>
        <summary>招待履歴 ({snapshot.invitations.length})</summary>
        <div className="admin-ledger-list">
          {snapshot.invitations.map((invitation) => (
            <article
              className="admin-ledger-card"
              key={invitation.invitationId}
            >
              <h3>{invitation.normalizedEmail}</h3>
              <p>
                {invitation.role === 'owner'
                  ? '管理者（既存招待）'
                  : invitation.canUseAi
                    ? '教員（AI利用可）'
                    : '教員（AI利用不可）'}{' '}
                / {INVITATION_STATUS_LABELS[invitation.status] ?? '状態確認中'}
              </p>
              {invitation.status === 'pending' ? (
                <button
                  disabled={busy || mutationBlocked}
                  onClick={() =>
                    startMutation({
                      action: 'revokeInvitation',
                      payload: {
                        expectedStatus: 'pending',
                        expectedUpdatedAt: invitation.updatedAt,
                        invitationId: invitation.invitationId,
                      },
                    })
                  }
                  type="button"
                >
                  招待を取り消す
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </details>

      <details>
        <summary>すべての操作履歴 ({auditEvents.length})</summary>
        <ol className="admin-ledger-audit">
          {auditEvents.map((event) => (
            <li key={event.eventId}>
              <strong>
                {event.action.startsWith('admin_ledger.')
                  ? (MUTATION_LABELS[
                      event.action.slice(
                        'admin_ledger.'.length,
                      ) as AdminLedgerMutationAction
                    ] ?? '管理操作')
                  : '認証・権限操作'}
              </strong>{' '}
              / {AUDIT_RESULT_LABELS[event.result] ?? '記録済み'} /{' '}
              {new Date(event.occurredAt).toLocaleString('ja-JP')}
            </li>
          ))}
        </ol>
        {auditEvents.length >= 50 ? (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void loadOlderAudit()}
            type="button"
          >
            以前の履歴を読む
          </button>
        ) : null}
      </details>
    </section>
  )
}
