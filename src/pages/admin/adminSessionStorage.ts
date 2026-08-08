export const ADMIN_SESSION_STORAGE_KEY =
  'compass-interactive-admin-authenticated'
export const ADMIN_TOKEN_SESSION_STORAGE_KEY = 'compass-interactive-admin-token'
export const PUBLISHER_SESSION_STORAGE_KEY =
  'compass-interactive-publisher-session-token'

export function restoreAdminSession() {
  return window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === 'true'
}

export function restoreAdminToken() {
  return window.sessionStorage.getItem(ADMIN_TOKEN_SESSION_STORAGE_KEY) ?? ''
}

export function restorePublisherSessionToken() {
  return window.sessionStorage.getItem(PUBLISHER_SESSION_STORAGE_KEY) ?? ''
}
