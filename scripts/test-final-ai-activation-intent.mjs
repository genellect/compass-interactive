import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const migrationPath =
  'supabase/migrations/20260825183000_durable_admin_ai_activation_intent.sql'
const migration = read(migrationPath)
const statusAfterCloseMigration = read(
  'supabase/migrations/20260825190000_ai_activation_intent_status_retained.sql',
)
const edge = read('supabase/functions/manage-ai-activation-intent/index.ts')
const repository = read(
  'src/repositories/supabase/aiActivationIntentRepository.ts',
)
const control = read(
  'src/components/AdminAiControl/AiMasterAuthorizationControl.tsx',
)
const adminAiControlPanel = read(
  'src/components/AdminWorkspace/AdminAiControlPanel.tsx',
)
const transport = read('src/repositories/supabase/transport.ts')
const config = read('supabase/config.toml')
const databaseTypes = read('src/types/database.ts')

assert.equal(
  existsSync(
    new URL(
      '../supabase/migrations/20260825180000_durable_admin_ai_activation_intent.sql',
      import.meta.url,
    ),
  ),
  false,
  'the AI intent migration must not collide with the caption migration',
)
assert.equal(
  existsSync(new URL('../src/lib/aiActivationIntent.ts', import.meta.url)),
  false,
  'sessionStorage intent persistence must be removed',
)

for (const policy of [
  'manage-ai-activation-intent.status',
  'manage-ai-activation-intent.arm',
  'manage-ai-activation-intent.cancel',
  'manage-ai-activation-intent.consume',
]) {
  assert.match(migration, new RegExp(`'${policy.replaceAll('.', '\\.')}'`))
}
assert.match(
  migration,
  /'owned_lecture',[\s\S]*?'draft_or_open',[\s\S]*?'gate_independent',[\s\S]*?'read'/,
)
assert.match(
  migration,
  /'manage-ai-activation-intent\.arm',[\s\S]*?'owned_lecture',[\s\S]*?'draft',[\s\S]*?'required',[\s\S]*?'write',[\s\S]*?true,[\s\S]*?true,[\s\S]*?true/,
)
assert.match(
  migration,
  /'manage-ai-activation-intent\.cancel',[\s\S]*?'owned_lecture',[\s\S]*?'draft_or_open',[\s\S]*?'gate_independent',[\s\S]*?'free_control',[\s\S]*?false,[\s\S]*?false,[\s\S]*?true/,
)
const statusAfterCloseCorrection =
  statusAfterCloseMigration.match(/do \$\$[\s\S]*?\n\$\$;/)?.[0] ?? ''
assert.equal(
  (
    statusAfterCloseCorrection.match(
      /update\s+private\.admin_google_operation_policies/g,
    ) ?? []
  ).length,
  1,
  'the status-after-close migration must update exactly one policy statement',
)
assert.match(
  statusAfterCloseCorrection,
  /set lecture_state = 'retained'[\s\S]*?where operation_key = 'manage-ai-activation-intent\.status'[\s\S]*?and edge_function = 'manage-ai-activation-intent'[\s\S]*?and action_name = 'status'[\s\S]*?and access_scope = 'owned_lecture'[\s\S]*?and lecture_state = 'draft_or_open'[\s\S]*?and gate_mode = 'gate_independent'[\s\S]*?and operation_class = 'read'[\s\S]*?and lecture_lock_mode = 'share'[\s\S]*?and instructor_requires_ai = false[\s\S]*?and owner_requires_ai = false[\s\S]*?and request_binding_required = false[\s\S]*?and control_step_up_action is null/,
  'the correction must match the complete old status policy before widening only its lecture state',
)
assert.match(
  statusAfterCloseCorrection,
  /get diagnostics updated_policy_count = row_count;[\s\S]*?if updated_policy_count <> 1 then[\s\S]*?raise exception/,
  'the correction must fail unless exactly one policy row changes',
)
assert.doesNotMatch(
  statusAfterCloseCorrection,
  /\b(?:insert\s+into|delete\s+from|truncate|alter\s+table)\b/i,
  'the correction block must not mutate any other database surface',
)
assert.match(
  statusAfterCloseMigration,
  /drop trigger admin_google_operation_policies_immutable[\s\S]*?create trigger admin_google_operation_policies_immutable\s+before update or delete on private\.admin_google_operation_policies\s+for each row execute function private\.reject_admin_c1_evidence_mutation_v1\(\);/,
  'the operation policy immutability guard must be restored in the same migration',
)
assert.match(
  migration,
  /when target_action = 'set' and target_enabled is true[\s\S]*?'manage-ai-activation-intent\.arm'[\s\S]*?when target_action = 'set' and target_enabled is false[\s\S]*?'manage-ai-activation-intent\.cancel'/,
)
assert.match(migration, /create table private\.admin_ai_activation_intents/)
assert.match(
  migration,
  /admin_session_id uuid not null[\s\S]*references public\.admin_sessions\(id\) on delete restrict/,
)
assert.match(migration, /activation_expires_at timestamptz/)
assert.match(
  migration,
  /alter table private\.admin_ai_activation_intents enable row level security;[\s\S]*revoke all on private\.admin_ai_activation_intents\s+from public, anon, authenticated, service_role;/,
)
assert.match(migration, /require_google_admin_operation_context_v1/)
assert.match(migration, /assert_google_admin_operation_lecture_state_v1/)
assert.match(migration, /serialize_admin_ai_request_v1\(target_request_id\)/)
assert.match(migration, /private\.admin_google_operation_receipts/)
assert.match(
  migration,
  /context_value ->> 'lecture_status' <> 'open'[\s\S]*master\.status = 'active'[\s\S]*master\.expires_at > effective_now/,
)
const intentMutation =
  migration.match(
    /create function private\.manage_google_admin_ai_activation_intent_v1[\s\S]*?\n\$\$;/,
  )?.[0] ?? ''
const armPrelude = intentMutation.slice(
  intentMutation.indexOf("if target_action = 'set' and target_enabled then"),
  intentMutation.indexOf(
    'context_value := private.require_google_admin_operation_context_v1',
  ),
)
assert.match(
  armPrelude,
  /require_google_ai_provider_context_v1[\s\S]*from private\.admin_identity_runtime_gate as gate[\s\S]*for share;[\s\S]*from private\.admin_ai_unlock_runtime_gate as gate[\s\S]*for share;/,
  'arm/re-arm must establish the canonical identity and AI gate prelude',
)
assert.match(
  intentMutation,
  /ai_gate\.ai_unlock_enabled is distinct from true[\s\S]*ai_gate\.google_ai_master_admission_enabled is distinct from true/,
  'arm/re-arm must require both AI admission flags',
)
assert.ok(
  intentMutation.indexOf('require_google_ai_provider_context_v1') <
    intentMutation.indexOf(
      'from private.admin_identity_runtime_gate as gate',
    ) &&
    intentMutation.indexOf('from private.admin_identity_runtime_gate as gate') <
      intentMutation.indexOf(
        'from private.admin_ai_unlock_runtime_gate as gate',
      ) &&
    intentMutation.indexOf(
      'from private.admin_ai_unlock_runtime_gate as gate',
    ) <
      intentMutation.indexOf(
        'context_value := private.require_google_admin_operation_context_v1',
      ) &&
    intentMutation.indexOf(
      'context_value := private.require_google_admin_operation_context_v1',
    ) <
      intentMutation.indexOf(
        'from private.admin_ai_activation_intents as intent',
        intentMutation.indexOf('-- Consumption follows'),
      ),
  'arm must preserve provider prelude -> identity gate -> AI gate -> owned lecture/context -> intent order',
)
assert.ok(
  intentMutation.indexOf(
    'from public.lecture_ai_master_authorizations',
    intentMutation.indexOf('-- Consumption follows'),
  ) <
    intentMutation.indexOf(
      'from private.admin_ai_activation_intents',
      intentMutation.indexOf('-- Consumption follows'),
    ),
  'consume must preserve lecture -> master -> intent serialization',
)
assert.match(
  intentMutation,
  /if target_enabled and intent_row\.lecture_session_id is null[\s\S]*elsif target_enabled and intent_row\.state = 'cancelled'[\s\S]*elsif not target_enabled and intent_row\.state = 'armed'/,
  'arm creates/re-arms only in draft, cancel transitions only armed, and consumed remains terminal',
)
for (const binding of [
  /master\.principal_id = \(context_value ->> 'principal_id'\)::uuid/,
  /master\.membership_id = \(context_value ->> 'membership_id'\)::uuid/,
  /master\.issuing_admin_session_id =[\s\S]*\(context_value ->> 'admin_session_id'\)::uuid/,
  /consumed_master_authorization_id = master_row\.id/,
]) {
  assert.match(migration, binding)
}
assert.doesNotMatch(
  migration,
  /(?:perform|select|insert into|update|delete from)\s+(?:private\.|public\.)?(?:start_lecture_ai_operation|ai_billing_grants|provider_dispatch)|sdp_offer\s*=|prompt\s*=/i,
  'arming and consumption must not start or duplicate paid/provider payloads',
)
assert.match(
  migration,
  /grant execute on function public\.manage_google_admin_ai_activation_intent_v1\([\s\S]*?\) to service_role;/,
)

const atomicAdmission =
  migration.match(
    /create function private\.authorize_google_ai_master_from_activation_intent_v1[\s\S]*?\n\$\$;/,
  )?.[0] ?? ''
assert.ok(
  atomicAdmission.indexOf('authorize_google_ai_master_with_session_v1') <
    atomicAdmission.indexOf('from public.lecture_ai_master_authorizations') &&
    atomicAdmission.indexOf('from public.lecture_ai_master_authorizations') <
      atomicAdmission.indexOf('from private.admin_ai_activation_intents'),
  'atomic auto-admission must take canonical admission/master locks before the intent lock',
)
assert.match(
  atomicAdmission,
  /intent_row\.state = 'consumed'[\s\S]*consumed_master_authorization_id <> master_row\.id[\s\S]*activation_intent_replayed', true/,
)
assert.match(
  atomicAdmission,
  /intent_row\.state <> 'armed'[\s\S]*intent_row\.version <> target_intent_version[\s\S]*activation_expires_at is null[\s\S]*activation_expires_at <= effective_now/,
)
assert.match(
  migration,
  /grant execute on function\s+public\.authorize_google_ai_master_from_activation_intent_v1\([\s\S]*?\) to service_role;/,
)
for (const drain of [
  'lecture_handoff',
  'master_terminal',
  'session_revoke',
  'membership_drain',
  'principal_drain',
  'environment_drain',
  'identity_gate_drain',
  'ai_gate_drain',
]) {
  assert.match(migration, new RegExp(`zz_admin_ai_activation_intent_${drain}`))
}
assert.match(
  migration,
  /effective_now \+ interval '5 minutes'[\s\S]*version = intent\.version \+ 1[\s\S]*where intent\.lecture_session_id = new\.id[\s\S]*intent\.state = 'armed'/,
  'lecture open must create a bounded, versioned handoff only from armed state',
)
assert.match(
  migration,
  /old\.ai_unlock_enabled[\s\S]*old\.google_ai_master_admission_enabled[\s\S]*not new\.ai_unlock_enabled[\s\S]*not new\.google_ai_master_admission_enabled[\s\S]*'ai_master_admission_disabled'/,
  'gate disable must cancel armed intents; re-enable has no transition that revives them',
)

assert.match(edge, /verifyGoogleAdminOperationRequest/)
assert.match(edge, /hasLegacyAdminFields\(body\)/)
assert.match(edge, /value !== null && !Array\.isArray\(value\)/)
assert.match(edge, /manage_google_admin_ai_activation_intent_v1/)
assert.match(edge, /target_transport_enabled: verification\.transportEnabled/)
assert.match(edge, /activationExpiresAt: status\.activation_expires_at/)
assert.match(
  config,
  /\[functions\.manage-ai-activation-intent\]\s+verify_jwt = true/,
)
assert.match(
  transport,
  /\['manage-ai-activation-intent', new Set\(\['status'\]\)\]/,
)
assert.match(
  databaseTypes,
  /manage_google_admin_ai_activation_intent_v1: \{[\s\S]*target_action: string[\s\S]*target_enabled: boolean[\s\S]*target_lecture_session_id: string[\s\S]*target_request_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /authorize_google_ai_master_from_activation_intent_v1: \{[\s\S]*target_intent_version: number[\s\S]*target_lecture_session_id: string[\s\S]*target_request_id: string[\s\S]*Returns: Json/,
)

for (const method of [
  'getAiActivationIntent',
  'setAiActivationIntent',
  'consumeAiActivationIntent',
]) {
  assert.match(repository, new RegExp(method))
  assert.match(control, new RegExp(method))
}
assert.doesNotMatch(control, /sessionStorage|hasAiActivationIntent/)
assert.match(repository, /activationExpiresAt: string \| null/)
assert.match(repository, /activationExpiresAt: value\.activationExpiresAt/)
assert.match(control, /const lectureSessionIdRef = useRef\(lectureSessionId\)/)
assert.ok(
  (
    control.match(/lectureSessionIdRef\.current !== targetLectureSessionId/g) ??
    []
  ).length >= 5,
  'late intent, status, master, consume and revoke responses must not cross lectures',
)
assert.match(
  control,
  /authorization\?\.status !== 'active'[\s\S]*consumeAttemptCountRef\.current >= 3[\s\S]*consumeActivationIntent/,
  'an owned active master consumes directly with a bounded retry loop',
)
assert.match(
  control,
  /intent\.activationExpiresAt === null[\s\S]*Date\.parse\(intent\.serverTime\)[\s\S]*status\.lectureOpen[\s\S]*intent\.state === 'armed'[\s\S]*activationExpiresAt > intentServerTime[\s\S]*activationHandoffLectureRef\.current = targetLectureSessionId[\s\S]*activationHandoffVersionRef\.current = intent\.version/,
  'an open late mount must restore only a live server-authoritative handoff',
)
assert.doesNotMatch(
  control,
  /previousLectureStatusRef|previousLectureStatus === 'draft'/,
  'automatic activation must not depend on observing the in-memory draft-to-open transition',
)
const automaticAdmission =
  control.match(
    /useEffect\(\(\) => \{[\s\S]*?activationHandoffLectureRef\.current !== lectureSessionId[\s\S]*?void authorize\(activationIntentVersion\)[\s\S]*?\n  \}, \[/,
  )?.[0] ?? ''
assert.doesNotMatch(
  automaticAdmission,
  /authorization\?\.status === 'active'/,
  'a live restored handoff must use the atomic wrapper even when admission reuses an active master',
)
assert.match(
  control,
  /authorization\?\.status !== 'active'[\s\S]*activationHandoffLectureRef\.current === lectureSessionId[\s\S]*activationHandoffVersionRef\.current !== null[\s\S]*consumeActivationIntent/,
  'the legacy consume recovery must not race the atomic live-handoff wrapper',
)
assert.match(control, /予約の完了を再確認/)
assert.match(
  control,
  /lectureStatus === 'draft'[\s\S]*講義開始時にAI機能を有効にする/,
)
assert.doesNotMatch(control, /ADMIN_PIN|BILLING_PIN|TOTP|totp/)
assert.match(
  adminAiControlPanel,
  /<MaterialAnalysisControl[\s\S]*key=\{`\$\{activeLectureSessionId\}:\$\{documents[\s\S]*document\.documentId[\s\S]*document\.documentVersion/,
  'material analysis UI must remount at lecture and document identity boundaries',
)

console.log('Final AI activation intent static checks passed.')
