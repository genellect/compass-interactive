import type { TeacherWorkspaceView } from '../../pages/admin/adminPageViewModel'

type Props = {
  activeView: TeacherWorkspaceView
  aiActive: boolean
  canShowAi: boolean
  canShowParticipation: boolean
  canShowSlides: boolean
  onSelect: (view: TeacherWorkspaceView) => void
}

const items: Array<{
  description: string
  label: string
  number: string
  view: TeacherWorkspaceView
}> = [
  {
    description: '資料・タイトル',
    label: '準備',
    number: '1',
    view: 'setup',
  },
  {
    description: 'ページ操作',
    label: 'スライド',
    number: '2',
    view: 'slides',
  },
  {
    description: '投票・コメント',
    label: '参加',
    number: '3',
    view: 'participation',
  },
  {
    description: '任意で有効化',
    label: 'AI',
    number: '4',
    view: 'ai',
  },
]

export function TeacherWorkspaceNav({
  activeView,
  aiActive,
  canShowAi,
  canShowParticipation,
  canShowSlides,
  onSelect,
}: Props) {
  const available = new Set<TeacherWorkspaceView>(['setup'])
  if (canShowSlides) available.add('slides')
  if (canShowParticipation) available.add('participation')
  if (canShowAi) available.add('ai')

  return (
    <nav
      aria-label="教員ワークスペース"
      className="admin-workflow"
      role="tablist"
    >
      {items.map((item) => {
        const enabled = available.has(item.view)
        const selected = activeView === item.view
        const controlledPanel =
          item.view === 'setup' || item.view === 'slides'
            ? 'teacher-workspace-material'
            : `teacher-workspace-${item.view}`
        const description =
          item.view === 'ai' && aiActive ? '利用中' : item.description
        return (
          <button
            aria-controls={controlledPanel}
            aria-disabled={!enabled}
            aria-selected={selected}
            className={selected ? 'is-active' : undefined}
            disabled={!enabled}
            id={`teacher-workspace-${item.view}-tab`}
            key={item.view}
            onClick={() => {
              if (enabled) onSelect(item.view)
            }}
            role="tab"
            type="button"
          >
            <span>{item.number}</span>
            <strong>{item.label}</strong>
            <small>{description}</small>
          </button>
        )
      })}
    </nav>
  )
}
