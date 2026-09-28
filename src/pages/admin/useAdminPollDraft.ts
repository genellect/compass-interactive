import { useState } from 'react'
import type { AdminPoll } from '../../repositories/supabaseAdminRepository'

export function useAdminPollDraft() {
  const [newPollQuestion, setNewPollQuestion] = useState('')
  const [newPollType, setNewPollType] = useState<AdminPoll['type']>('single')
  const [newPollOptionCount, setNewPollOptionCount] = useState(4)
  const [newPollOptions, setNewPollOptions] = useState<string[]>(() =>
    Array(8).fill(''),
  )

  function resetPollDraft() {
    setNewPollQuestion('')
    setNewPollOptions(Array(8).fill(''))
    setNewPollOptionCount(4)
  }

  return {
    newPollQuestion, setNewPollQuestion,
    newPollType, setNewPollType,
    newPollOptionCount, setNewPollOptionCount,
    newPollOptions, setNewPollOptions,
    resetPollDraft,
  }
}
