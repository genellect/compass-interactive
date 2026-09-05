import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router'
import { lazy, Suspense, type ReactNode } from 'react'
import { AppIcon } from './components/AppIcon'
import { CompassContextMenu } from './components/CompassContextMenu'
import { CompassStateProvider } from './context/CompassStateContext'
import { useCompassState } from './hooks/useCompassState'
import { getAdminOAuthFailure } from './lib/adminAuth/adminOAuthFailure'
import './App.css'

const AdminRoute = lazy(() =>
  import('./pages/AdminRoute').then((module) => ({
    default: module.AdminRoute,
  })),
)
const DisplayPage = lazy(() =>
  import('./pages/DisplayPage').then((module) => ({
    default: module.DisplayPage,
  })),
)
const DemoDisplayPage = lazy(() =>
  import('./pages/DemoDisplayPage').then((module) => ({
    default: module.DemoDisplayPage,
  })),
)
const JoinPage = lazy(() =>
  import('./pages/JoinPage').then((module) => ({ default: module.JoinPage })),
)
const LecturePage = lazy(() =>
  import('./pages/LecturePage').then((module) => ({
    default: module.LecturePage,
  })),
)
const CommentHistoryPage = lazy(() =>
  import('./pages/CommentHistoryPage').then((module) => ({
    default: module.CommentHistoryPage,
  })),
)
const LectureArchivePage = lazy(() =>
  import('./pages/LectureArchivePage').then((module) => ({
    default: module.LectureArchivePage,
  })),
)

const publicNavItems = [
  { to: '/demo', label: 'デモを体験', icon: 'sparkles' as const },
]

const joinedNavItems = [
  { to: '/lecture', label: '講義', icon: 'book' as const },
  { to: '/display', label: '教室表示', icon: 'display' as const },
]

const demoJoinedNavItems = joinedNavItems.map((item) =>
  item.to === '/display' ? { ...item, to: '/demo/display' } : item,
)

const adminNavItems = [
  { to: '/join', label: '学生画面', icon: 'users' as const },
]

function RequireJoinedLecture({ children }: { children: ReactNode }) {
  const { hasJoinedLectureSession } = useCompassState()

  if (!hasJoinedLectureSession) {
    return <Navigate replace to="/join" />
  }

  return children
}

function RouteFallback() {
  return (
    <main className="route-fallback" aria-live="polite">
      <span className="route-loader" aria-hidden="true" />
      <p>講義画面を整えています…</p>
    </main>
  )
}

function AppShell() {
  const { hasJoinedLectureSession, runtimeMode } = useCompassState()
  const location = useLocation()
  const isAdminRoute = location.pathname.startsWith('/admin')
  const appTheme = 'theme-light'
  const navItems = isAdminRoute
    ? adminNavItems
    : hasJoinedLectureSession
      ? runtimeMode === 'demo'
        ? demoJoinedNavItems
        : joinedNavItems
      : publicNavItems

  return (
    <div className={`app-root ${appTheme}`}>
      <header className="app-header">
        <a className="brand" href="/join" aria-label="COMPASS Interactive">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            <strong>COMPASS Interactive</strong>
            <small>Lecture Experience</small>
          </span>
        </a>
        <div className="app-header-actions">
          <nav aria-label="画面切り替え">
            {navItems.map((item) => (
              <NavLink className="nav-link" key={item.to} to={item.to}>
                <AppIcon name={item.icon} size={17} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <CompassContextMenu />
        </div>
      </header>

      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<Navigate replace to="/join" />} path="/" />
          <Route element={<JoinPage />} path="/join" />
          <Route
            element={<Navigate replace to="/join?code=DEMO" />}
            path="/demo"
          />
          <Route element={<DemoDisplayPage />} path="/demo/display" />
          <Route
            element={
              <RequireJoinedLecture>
                <LecturePage />
              </RequireJoinedLecture>
            }
            path="/lecture"
          />
          <Route
            element={
              <RequireJoinedLecture>
                <CommentHistoryPage />
              </RequireJoinedLecture>
            }
            path="/lecture/comments"
          />
          <Route element={<LectureArchivePage />} path="/lecture/archive" />
          <Route element={<DisplayPage />} path="/display" />
        </Routes>
      </Suspense>
    </div>
  )
}

function App() {
  const location = useLocation()
  const rootOAuthFailure =
    location.pathname === '/'
      ? getAdminOAuthFailure(location.search, location.hash)
      : null
  if (rootOAuthFailure) {
    return (
      <Navigate
        replace
        to={`/admin/auth/callback?oauth_error=${rootOAuthFailure}`}
      />
    )
  }
  if (location.pathname.startsWith('/admin')) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <AdminRoute />
      </Suspense>
    )
  }

  return (
    <CompassStateProvider>
      <AppShell />
    </CompassStateProvider>
  )
}

export default App
