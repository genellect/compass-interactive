import { CompassStateProvider } from '../context/CompassStateContext'
import { AdminPage } from './AdminPage'

export default function AdminLegacyApp() {
  return (
    <CompassStateProvider>
      <AdminPage />
    </CompassStateProvider>
  )
}
