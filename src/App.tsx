import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'
import { AppIcon } from './components/AppIcon'
import { CompassStateProvider } from './context/CompassStateContext'
import { useCompassState } from './hooks/useCompassState'
import './App.css'

const AdminPage = lazy(() =>
  import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })),
)
const DisplayPage = lazy(() =>
  import('./pages/DisplayPage').then((module) => ({
    default: module.DisplayPage,
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

const publicNavItems = [
  { to: '/demo', label: 'デモを体験', icon: 'sparkles' as const },
]

const joinedNavItems = [
  { to: '/lecture', label: '講義', icon: 'book' as const },
  { to: '/display', label: '教室表示', icon: 'display' as const },
]

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
  const { hasJoinedLectureSession } = useCompassState()
  const location = useLocation()
  const isAdminRoute = location.pathname.startsWith('/admin')
  const isDisplayRoute = location.pathname.startsWith('/display')
  const appTheme = isDisplayRoute ? 'theme-dark' : 'theme-light'
  const navItems = isAdminRoute
    ? adminNavItems
    : hasJoinedLectureSession
      ? joinedNavItems
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
        <nav aria-label="画面切り替え">
          {navItems.map((item) => (
            <NavLink className="nav-link" key={item.to} to={item.to}>
              <AppIcon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<Navigate replace to="/join" />} path="/" />
          <Route element={<JoinPage />} path="/join" />
          <Route
            element={<Navigate replace to="/join?code=DEMO" />}
            path="/demo"
          />
          <Route element={<AdminPage />} path="/admin" />
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
                <DisplayPage />
              </RequireJoinedLecture>
            }
            path="/display"
          />
        </Routes>
      </Suspense>
    </div>
  )
}

function App() {
  return (
    <CompassStateProvider>
      <AppShell />
    </CompassStateProvider>
  )
}

export default App
