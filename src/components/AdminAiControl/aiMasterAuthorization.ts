import type {
  AiBillingAction,
  AiMasterAuthorization,
} from '../../repositories/supabaseAdminRepository'

export function masterAuthorizesFeature(
  authorization: AiMasterAuthorization | null,
  feature: AiBillingAction,
) {
  return (
    authorization?.status === 'active' &&
    authorization.ownedByRequester &&
    authorization.actions.includes(feature)
  )
}

export function masterAuthorizationHeldByOther(
  authorization: AiMasterAuthorization | null,
) {
  return authorization?.status === 'active' && !authorization.ownedByRequester
}
