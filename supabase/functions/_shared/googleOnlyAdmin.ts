const LEGACY_ADMIN_FIELDS = ['adminToken', 'billingGrant', 'billingPin'] as const

export function hasLegacyAdminFields(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return LEGACY_ADMIN_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(value, field),
  )
}
