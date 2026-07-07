import { useContext } from 'react'
import { CompassStateContext } from '../context/CompassStateValue'

export function useCompassState() {
  const value = useContext(CompassStateContext)
  if (!value) {
    throw new Error('useCompassState must be used within CompassStateProvider')
  }
  return value
}
