// The same three terms are bound into the database's exact-intent digest.
// Never accept provider/model/role/session changes in this small budget contract.
export function normalizeAdminLedgerAiPolicy(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const terms = value as Record<string, unknown>
  const keys = Object.keys(terms).sort()
  const expected = [
    'maxCostMicrousdPerDay',
    'maxCostMicrousdPerLecture',
    'validityDays',
  ]
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  )
    return null
  const lectureLimit = terms.maxCostMicrousdPerLecture
  const dayLimit = terms.maxCostMicrousdPerDay
  if (
    typeof lectureLimit !== 'number' ||
    !Number.isSafeInteger(lectureLimit) ||
    lectureLimit < 10_000 ||
    lectureLimit > 5_000_000 ||
    typeof dayLimit !== 'number' ||
    !Number.isSafeInteger(dayLimit) ||
    dayLimit < lectureLimit ||
    dayLimit > 20_000_000 ||
    terms.validityDays !== 30
  )
    return null
  return {
    max_cost_microusd_per_lecture: lectureLimit,
    max_cost_microusd_per_day: dayLimit,
    validity_days: 30,
  }
}
