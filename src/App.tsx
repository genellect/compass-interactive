import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { CompassStateProvider } from './context/CompassStateContext'
import { useCompassState } from './hooks/useCompassState'
import { AdminPage } from './pages/AdminPage'
import { DisplayPage } from './pages/DisplayPage'
import { JoinPage } from './pages/JoinPage'
import { LecturePage } from './pages/LecturePage'
import './App.css'

const publicNavItems = [{ to: '/join', label: '参加' }]

const joinedNavItems = [
  { to: '/lecture', label: '参加画面' },
  { to: '/display', label: '共有画面' },
  { to: '/admin', label: '管理者' },
]

function RequireJoinedLecture({ children }: { children: ReactNode }) {
  const { hasJoinedLectureSession } = useCompassState()

  if (!hasJoinedLectureSession) {
    return <Navigate replace to="/join" />
  }

  return children
}

function AppShell() {
  const { hasJoinedLectureSession } = useCompassState()
  const navItems = hasJoinedLectureSession ? joinedNavItems : publicNavItems

  return (
    <>
      <header className="app-header">
        <a className="brand" href="/join" aria-label="COMPASS Interactive">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            <strong>COMPASS</strong>
            <small>Interactive</small>
          </span>
        </a>
        <nav aria-label="画面切り替え">
          {navItems.map((item) => (
            <NavLink className="nav-link" key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <Routes>
        <Route element={<Navigate replace to="/join" />} path="/" />
        <Route element={<JoinPage />} path="/join" />
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
              <AdminPage />
            </RequireJoinedLecture>
          }
          path="/admin"
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
    </>
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
