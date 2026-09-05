export const DEFAULT_AI_LECTURE_COST = '3.00'
export const DEFAULT_AI_DAY_COST = '6.00'

export function dollarsToMicrousd(value: string, maximum: number) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(value.trim())) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0.01 || amount > maximum) return null
  return Math.round(amount * 1_000_000)
}
