export type AdminOAuthFailure = 'expired' | 'cancelled' | 'failed'

// Provider error descriptions are untrusted and may contain private details.
// Carry only a local classification to the educator route, never the raw URL.
export function getAdminOAuthFailure(
  search: string,
  hash = '',
): AdminOAuthFailure | null {
  for (const source of [search, hash.replace(/^#/, '')]) {
    const parameters = new URLSearchParams(source)
    if (!parameters.has('error') && !parameters.has('error_code')) continue
    const code = parameters.get('error_code')
    if (
      code === 'flow_state_expired' ||
      (code === 'bad_oauth_state' &&
        parameters.get('error_description') === 'OAuth state has expired')
    )
      return 'expired'
    if (parameters.get('error') === 'access_denied') return 'cancelled'
    return 'failed'
  }
  return null
}

export function getAdminOAuthFailureMessage(failure: string | null) {
  if (failure === 'expired') {
    return 'ログイン画面の有効期限が切れました。Googleで続けるから再度お進みください。'
  }
  if (failure === 'cancelled') {
    return 'Googleログインが中断されました。Googleで続けるから再度お進みください。'
  }
  return 'Googleログインを完了できませんでした。Googleで続けるから再度お進みください。'
}
