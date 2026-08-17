import { handoffAdminAppSessionToken } from './adminAuthStorage'

export type AdminSurfacePath = '/admin' | '/admin/settings'

const ADMIN_SURFACE_WINDOW_NAMES: Record<AdminSurfacePath, string> = {
  '/admin': 'compass-admin-workspace',
  '/admin/settings': 'compass-admin-settings',
}

function isAdminSurfacePath(pathname: string): pathname is AdminSurfacePath {
  return pathname === '/admin' || pathname === '/admin/settings'
}

function isCurrentAdminSurface(target: Window, pathname: AdminSurfacePath) {
  try {
    const currentPathname = target.location.pathname.replace(/\/+$/, '')
    return (
      target.location.origin === window.location.origin &&
      currentPathname === pathname
    )
  } catch {
    return false
  }
}

export function claimAdminSurfaceWindow(pathname: string) {
  if (!isAdminSurfacePath(pathname)) return () => undefined
  const previousName = window.name
  const surfaceName = ADMIN_SURFACE_WINDOW_NAMES[pathname]
  window.name = surfaceName
  return () => {
    if (window.name === surfaceName) window.name = previousName
  }
}

export function openAdminSurface(pathname: AdminSurfacePath) {
  const targetUrl = new URL(pathname, window.location.origin).href
  const opened = window.open('', ADMIN_SURFACE_WINDOW_NAMES[pathname])
  if (!opened) {
    window.location.assign(targetUrl)
    return
  }

  // Copy only the opaque Admin app-session bearer into the explicit
  // same-origin surface. It never enters localStorage, the URL or a cross-tab
  // broadcast channel. The production COOP same-origin header keeps these two
  // trusted surfaces in one browsing-context group while isolating any
  // cross-origin navigation.
  let sessionChanged = true
  try {
    sessionChanged = handoffAdminAppSessionToken(opened).changed
  } catch {
    // A reused surface may already be navigating; its fixed same-origin name
    // still prevents another privileged tab from being created.
  }
  if (sessionChanged || !isCurrentAdminSurface(opened, pathname)) {
    opened.location.replace(targetUrl)
  }
  opened.focus()
}
