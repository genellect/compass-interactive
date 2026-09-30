// Local-only component harness. Every repository method is replaced before mount.
import '../../src/index.css'
import '../../src/App.css'
import '../../src/pages/AdminPage.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ComponentProps } from 'react'
import { AdminAiControlPanel } from '../../src/components/AdminWorkspace/AdminAiControlPanel'
import { supabaseAdminRepository as repository } from '../../src/repositories/supabaseAdminRepository'

const calls: Array<{
  name: string
  lectureSessionId?: string
  scope?: string
}> = []
let releaseAuthorization: (() => void) | null = null
let holdAuthorization = false
let holdMicrophone = false
let releaseMicrophone: (() => void) | null = null
let holdIntentCancel = false
let releaseIntentCancel: (() => void) | null = null
let failSummary = false
let authorization: Record<string, unknown> | null = null
const now = new Date().toISOString()
const intent = {
  armed: false,
  version: 0,
  state: 'disarmed',
  serverTime: now,
  activationExpiresAt: null,
}
const emptySummaries = { control: null, run: null, summaries: [], windows: [] }
const masterStatus = () => ({
  admissionEnabled: true,
  admissionBlockedReason: null,
  allowedScopes: ['all_except_captions', 'all_including_captions'],
  authorization,
  canUseAi: true,
  lectureOpen: true,
  policy: { id: 'synthetic', version: 1 },
  reason: null,
  serverTime: now,
})
Object.assign(repository, {
  getAiMasterAuthorization: async () => masterStatus(),
  getAiActivationIntent: async () => intent,
  setAiActivationIntent: async () => {
    if (holdIntentCancel) {
      calls.push({ name: 'intentCancelHeld' })
      await new Promise<void>((resolve) => {
        releaseIntentCancel = resolve
      })
    }
    return intent
  },
  authorizeAiMasterWithAal2Session: async (request: {
    lectureSessionId: string
    masterScope: string
  }) => {
    calls.push({
      name: 'authorize',
      lectureSessionId: request.lectureSessionId,
      scope: request.masterScope,
    })
    if (holdAuthorization)
      await new Promise<void>((resolve) => {
        releaseAuthorization = resolve
      })
    authorization = {
      id: 'synthetic-master',
      scope: request.masterScope,
      status: 'active',
      ownedByRequester: true,
      actions: [
        'summaries',
        'academic_answers',
        'material_analysis',
        'poll_suggestions',
        ...(request.masterScope === 'all_including_captions'
          ? ['captions']
          : []),
      ],
      expiresAt: '2099-01-01T00:00:00Z',
    }
    return masterStatus()
  },
  revokeAiMasterAuthorization: async (request: {
    lectureSessionId: string
  }) => {
    calls.push({ name: 'revoke', lectureSessionId: request.lectureSessionId })
    authorization = null
  },
  manageLectureSummaries: async (request: {
    action: string
    lectureSessionId: string
  }) => {
    if (request.action === 'start') {
      calls.push({
        name: 'summaryStart',
        lectureSessionId: request.lectureSessionId,
      })
      if (failSummary) throw new Error('Synthetic summary failure')
      return {
        results: { ...emptySummaries, run: { status: 'running' } },
        runToken: 'synthetic-run',
      }
    }
    return { results: emptySummaries, runToken: null }
  },
  manageMaterialAnalysis: async () => ({
    results: { analysis: null, publication: null, proposals: [] },
  }),
  manageAcademicAnswers: async () => ({
    answers: [],
    candidates: [],
    activeRequestIds: [],
    activeRequests: [],
    control: null,
  }),
  manageAiControl: async () => ({ recentOperations: [] }),
  createRealtimeCaptionCall: async () => {
    calls.push({ name: 'captionProvider' })
    throw new Error('A microphone denial must not dispatch a provider')
  },
  generateLectureSummary: async () => {
    throw new Error('No summary window is due in this fixture')
  },
})
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
  configurable: true,
  value: async () => {
    calls.push({ name: 'microphone' })
    if (holdMicrophone)
      return await new Promise((resolve) => {
        releaseMicrophone = () =>
          resolve({
            getTracks: () => [
              { stop: () => calls.push({ name: 'trackStopped' }) },
            ],
          })
      })
    throw new DOMException('Synthetic microphone denial', 'NotAllowedError')
  },
})
const root = createRoot(document.getElementById('root')!)
let props = {
  activeLecture: undefined,
  activeLectureSessionId: 'lecture-a',
  adminToken: { kind: 'google', appSessionToken: 'synthetic-session-a' },
  academicEnabled: true,
  documents: [],
  displayState: null,
  fallbackHardStopAt: null,
  fallbackStartedAt: now,
  getServerNow: () => now,
  identityScope: {},
  lectureStatus: 'open',
  materialEnabled: true,
  onPollDraftCreated: async () => {},
  publisherSessionToken: '',
  realtimeEnabled: true,
  summariesEnabled: true,
} as ComponentProps<typeof AdminAiControlPanel>
const render = () =>
  flushSync(() =>
    root.render(
      <div className="app-root theme-light">
        <main className="page-shell admin-page-shell">
          <div className="teacher-workspace-stage">
            <AdminAiControlPanel {...props} />
          </div>
        </main>
      </div>,
    ),
  )
Object.assign(window, {
  aiHarness: {
    calls,
    configure(options: {
      hold?: boolean
      holdMicrophone?: boolean
      holdIntentCancel?: boolean
      failSummary?: boolean
      lectureId?: string
      session?: string
      captionsOnly?: boolean
      draft?: boolean
    }) {
      holdAuthorization = options.hold ?? holdAuthorization
      holdMicrophone = options.holdMicrophone ?? holdMicrophone
      holdIntentCancel = options.holdIntentCancel ?? holdIntentCancel
      failSummary = options.failSummary ?? failSummary
      props = {
        ...props,
        ...(options.lectureId
          ? { activeLectureSessionId: options.lectureId }
          : {}),
        ...(options.session
          ? {
              adminToken: {
                kind: 'google' as const,
                appSessionToken: options.session,
              },
            }
          : {}),
        ...(options.captionsOnly
          ? {
              materialEnabled: false,
              summariesEnabled: false,
              academicEnabled: false,
            }
          : {}),
        ...(options.draft === undefined
          ? {}
          : {
              lectureStatus: options.draft
                ? ('draft' as const)
                : ('open' as const),
            }),
      }
      render()
    },
    release() {
      holdAuthorization = false
      releaseAuthorization?.()
      releaseAuthorization = null
    },
    releaseMicrophone() {
      releaseMicrophone?.()
      releaseMicrophone = null
    },
    releaseIntentCancel() {
      releaseIntentCancel?.()
      releaseIntentCancel = null
    },
  },
})
render()
