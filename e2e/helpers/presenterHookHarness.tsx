/* oxlint-disable react/only-export-components -- Browser-only harness needs imperative mount/update controls. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useAdminPowerPointSync } from '../../src/components/AdminWorkspace/useAdminPowerPointSync'

type Input = Omit<
  Parameters<typeof useAdminPowerPointSync>[0],
  'onCommittedPage'
>
let updateInput: ((patch: Partial<Input>) => void) | null = null

function Harness({ initial }: { initial: Input }) {
  const [input, setInput] = useState(initial)
  updateInput = (patch) => setInput((current) => ({ ...current, ...patch }))
  const sync = useAdminPowerPointSync({
    ...input,
    onCommittedPage: () => undefined,
  })
  return (
    <section>
      <span data-testid="presenter-hook-phase">{sync.phase}</span>
      <span data-testid="presenter-hook-connection">
        {sync.serverConnection?.connectionId ?? ''}
      </span>
      <span data-testid="presenter-hook-locked">
        {String(sync.manualNavigationLocked)}
      </span>
      <button disabled={sync.busy} onClick={() => void sync.stop()}>
        Harness handover
      </button>
    </section>
  )
}

export function mountPresenterHookHarness(initial: Input) {
  const element = document.createElement('div')
  document.body.append(element)
  createRoot(element).render(<Harness initial={initial} />)
}

export function updatePresenterHookHarness(patch: Partial<Input>) {
  updateInput?.(patch)
}
