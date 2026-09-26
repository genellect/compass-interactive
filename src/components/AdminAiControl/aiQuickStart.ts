import type {
  AiMasterAuthorization,
  AiMasterAuthorizationScope,
} from '../../repositories/supabase/aiMasterAuthorizationRepository'

export type AiQuickStartRequest = {
  authorization: AiMasterAuthorization
  isCurrent: () => boolean
  includeAcademicAnswers?: boolean
}

export type AiQuickStartResult = {
  status: 'started' | 'already_active' | 'skipped' | 'failed'
  message: string
}

export type AiQuickStartHandle = {
  start: (request: AiQuickStartRequest) => Promise<AiQuickStartResult>
}

export type AiMasterControlHandle = {
  authorize: (
    scope: AiMasterAuthorizationScope,
  ) => Promise<AiMasterAuthorization | null>
  stop: () => Promise<void>
}

export const inactiveQuickStart: AiQuickStartResult = {
  status: 'skipped',
  message: '講義または利用状態が変わりました。',
}

// A non-caption start must never downgrade a running caption permission.
export function masterScopeIncludes(
  current: AiMasterAuthorizationScope,
  required: AiMasterAuthorizationScope,
) {
  return current === required || current === 'all_including_captions'
}

export async function runAiQuickStart(input: {
  authorize: AiMasterControlHandle['authorize']
  isCurrent: () => boolean
  scope: AiMasterAuthorizationScope
  steps: Array<{ name: string; start: AiQuickStartHandle['start'] }>
}): Promise<AiQuickStartResult[]> {
  if (!input.isCurrent()) return [inactiveQuickStart]
  const authorization = await input.authorize(input.scope)
  if (!input.isCurrent()) return [inactiveQuickStart]
  if (
    authorization?.status !== 'active' ||
    !authorization.ownedByRequester ||
    !masterScopeIncludes(authorization.scope, input.scope)
  ) {
    return [
      { status: 'failed', message: 'AI機能の利用許可を確認してください。' },
    ]
  }
  const results: AiQuickStartResult[] = []
  for (const step of input.steps) {
    if (!input.isCurrent()) return [...results, inactiveQuickStart]
    try {
      const result = await step.start({
        authorization,
        isCurrent: input.isCurrent,
      })
      if (!input.isCurrent()) return [...results, inactiveQuickStart]
      results.push({ ...result, message: `${step.name}: ${result.message}` })
    } catch {
      if (!input.isCurrent()) return [...results, inactiveQuickStart]
      results.push({
        status: 'failed',
        message: `${step.name}: 開始できませんでした。AIの詳細で確認してください。`,
      })
    }
  }
  return results
}
