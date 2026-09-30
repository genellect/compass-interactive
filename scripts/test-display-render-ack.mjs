import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Source regression harness. It executes the DisplayPage component with
// deterministic hooks and transport doubles. It does not mount a browser,
// render a real PDF or contact Supabase. Browser acceptance remains separate.
const checkout = fileURLToPath(new URL('..', import.meta.url))
const ts = require(path.join(checkout, 'node_modules/typescript'))
const sourcePath = process.argv.includes('--baseline')
  ? path.resolve(process.argv[process.argv.indexOf('--baseline') + 1])
  : path.join(checkout, 'src/pages/DisplayPage.tsx')
const renderEventsPath = path.join(
  checkout,
  'src/display/displayRenderEvents.ts',
)
const source = fs.readFileSync(sourcePath, 'utf8')
const eventsSource = fs.readFileSync(renderEventsPath, 'utf8')
const lessonId = '11111111-1111-4111-8111-111111111111'
const initialDisplay = {
  lectureSessionId: lessonId,
  pdfDocumentId: 'synthetic-document',
  pdfDocumentVersion: 'synthetic-version',
  pdfManifestVersion: 1,
  currentPdfPage: 12,
  pdfVisible: true,
  updatedAt: '2026-09-30T05:00:00.000Z',
}

function loadTypeScript(text, filename, mocks, globals) {
  const transpiled = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText
  const exports = {}
  const module = { exports }
  vm.runInNewContext(
    transpiled,
    {
      module,
      exports,
      require(name) {
        if (!(name in mocks)) throw new Error(`Unmocked dependency: ${name}`)
        return mocks[name]
      },
      ...globals,
    },
    { filename },
  )
  return module.exports
}

async function createHarness() {
  const eventTarget = new EventTarget()
  let timerId = 0
  const frames = new Map()
  const document = { documentElement: { dataset: {} } }
  const window = {
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    setInterval: () => ++timerId,
    clearInterval: () => {},
    setTimeout: () => ++timerId,
    clearTimeout: () => {},
    requestAnimationFrame(callback) {
      const id = ++timerId
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) {
      frames.delete(id)
    },
  }
  const globals = { window, document, Event, CustomEvent, console }
  const events = loadTypeScript(eventsSource, renderEventsPath, {}, globals)
  const cells = []
  let cursor = 0
  let dirty = true
  let pendingEffects = []
  let connection = null
  const reports = []
  const sameDeps = (left, right) =>
    Boolean(
      left &&
      right &&
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index])),
    )
  const React = {
    useRef(initialValue) {
      const index = cursor++
      cells[index] ??= { current: initialValue }
      return cells[index]
    },
    useState(initialValue) {
      const index = cursor++
      cells[index] ??= {
        value:
          typeof initialValue === 'function' ? initialValue() : initialValue,
      }
      const set = (newValue) => {
        const nextValue =
          typeof newValue === 'function'
            ? newValue(cells[index].value)
            : newValue
        if (Object.is(nextValue, cells[index].value)) return
        cells[index].value = nextValue
        dirty = true
      }
      return [cells[index].value, set]
    },
    useCallback(callback, deps) {
      const index = cursor++
      if (!cells[index] || !sameDeps(cells[index].deps, deps)) {
        cells[index] = { callback, deps }
      }
      return cells[index].callback
    },
    useEffect(effect, deps) {
      const index = cursor++
      if (!cells[index] || !sameDeps(cells[index].deps, deps)) {
        const previousCleanup = cells[index]?.cleanup
        cells[index] = { deps }
        pendingEffects.push(() => {
          previousCleanup?.()
          cells[index].cleanup = effect()
        })
      }
    },
  }
  const compass = {
    activeLectureSessionId: lessonId,
    caption: null,
    displayState: { ...initialDisplay },
    hasJoinedLectureSession: false,
    lecture: { id: lessonId, status: 'open' },
    runtimeMode: 'live',
    refreshDisplayState: async () => {},
    selectLectureSession: () => {},
    setOperatorLiveAccess: () => {},
    summaries: [],
    visibleComments: [],
  }
  const launch = {
    displayToken: 'synthetic-not-a-credential-'.repeat(5),
    lectureSessionId: lessonId,
    lectureCode: '',
    source: 'storage',
  }
  const mocks = {
    react: React,
    'react/jsx-runtime': {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    'react-router': { Link: () => null },
    '../components/DisplayView': { DisplayView: () => null },
    '../hooks/useCompassState': { useCompassState: () => compass },
    '../caption/captionBroadcast': {
      createCaptionBroadcastChannel: () => null,
      isCaptionBroadcastMessage: () => false,
    },
    '../lib/featureFlags': { isPhase728DisplayRealtimeEnabled: true },
    '../display/displayRealtime': {
      canFallbackFromDisplayRealtimeClaim: () => false,
      claimDisplayRealtimeSession: async () => ({ lectureSessionId: lessonId }),
      createDisplaySessionReporter: (input) => ({
        close: () => {},
        reportRendered(rendered) {
          reports.push({ ...rendered })
          input.onStatus('ready')
        },
      }),
      subscribeClaimedDisplayRealtimeSession: async (input) => {
        connection = input
        return async () => {}
      },
    },
    '../display/displaySessionStorage': {
      clearStoredDisplayLaunch: () => {},
      persistClaimedDisplayLaunch: () => ({ connectionGeneration: 1 }),
      readDisplayLaunch: () => launch,
      stripDisplayLaunchFragment: () => {},
    },
    '../display/displayRenderEvents': events,
    '../display/displaySummary': { getLatestPublicSummary: () => null },
  }
  const { DisplayPage } = loadTypeScript(source, sourcePath, mocks, globals)
  async function settle({ flushFrames = true } = {}) {
    for (let step = 0; step < 12; step++) {
      if (dirty) {
        dirty = false
        cursor = 0
        pendingEffects = []
        DisplayPage()
        for (const commit of pendingEffects) commit()
      }
      await Promise.resolve()
      if (flushFrames) {
        for (const [id, callback] of [...frames]) {
          frames.delete(id)
          callback()
        }
      }
    }
  }
  await settle()
  assert.ok(connection, 'claimed Realtime subscription was created')
  return {
    compass,
    document,
    events,
    reports,
    settle,
    async status(status, options) {
      connection.onConnectionStatus(status)
      await settle(options)
    },
    render(page = compass.displayState.currentPdfPage, changes = {}) {
      events.publishDisplayPdfRendered({
        documentId: compass.displayState.pdfDocumentId,
        documentVersion: compass.displayState.pdfDocumentVersion,
        lectureSessionId: lessonId,
        manifestVersion: compass.displayState.pdfManifestVersion,
        page,
        isStillRendered: () => true,
        ...changes,
      })
    },
    async snapshot(changes) {
      compass.displayState = { ...compass.displayState, ...changes }
      dirty = true
      await settle()
    },
    async end() {
      connection.onSessionClosed('session_replaced')
      await settle()
    },
    close() {
      for (const cell of cells) cell?.cleanup?.()
    },
  }
}

async function main() {
  const beforeSubscribe = await createHarness()
  beforeSubscribe.render()
  await beforeSubscribe.status('SUBSCRIBED')
  assert.equal(
    beforeSubscribe.reports.length,
    1,
    'SUBSCRIBED must report an already-rendered current PDF without page navigation',
  )
  assert.equal(
    beforeSubscribe.document.documentElement.dataset.displayDelivery,
    'ready',
  )
  await beforeSubscribe.snapshot({ updatedAt: '2026-09-30T05:00:01.000Z' })
  assert.equal(
    beforeSubscribe.reports.at(-1).displayUpdatedAt,
    '2026-09-30T05:00:01.000Z',
    'a non-page snapshot update can ACK the same valid rendered PDF',
  )
  await beforeSubscribe.snapshot({
    currentPdfPage: 11,
    updatedAt: '2026-09-30T05:00:02.000Z',
  })
  beforeSubscribe.render()
  assert.equal(beforeSubscribe.reports.at(-1).renderedPage, 11)
  beforeSubscribe.close()

  const afterSubscribe = await createHarness()
  await afterSubscribe.status('SUBSCRIBED')
  assert.equal(
    afterSubscribe.reports.length,
    0,
    'subscription alone is not proof of a rendered PDF',
  )
  afterSubscribe.render()
  assert.equal(afterSubscribe.reports.length, 1)
  await afterSubscribe.status('CHANNEL_ERROR')
  await afterSubscribe.status('SUBSCRIBED')
  assert.equal(
    afterSubscribe.reports.length,
    2,
    'reconnect must preserve still-valid evidence for the same rendered PDF',
  )
  afterSubscribe.render()
  assert.equal(afterSubscribe.reports.length, 3)
  await afterSubscribe.end()
  afterSubscribe.render()
  assert.equal(
    afterSubscribe.reports.length,
    3,
    'session replacement closes the reporter and prevents another ACK',
  )
  afterSubscribe.close()

  const mismatch = await createHarness()
  await mismatch.status('SUBSCRIBED')
  for (const changes of [
    { lectureSessionId: '22222222-2222-4222-8222-222222222222' },
    { documentId: 'other-document' },
    { documentVersion: 'other-version' },
    { manifestVersion: 2 },
    { page: 11 },
  ])
    mismatch.render(12, changes)
  assert.equal(mismatch.reports.length, 0)
  mismatch.close()
  mismatch.render()
  assert.equal(
    mismatch.reports.length,
    0,
    'component cleanup removes the render listener',
  )

  for (const stage of ['before-subscription', 'before-frame']) {
    const invalidated = await createHarness()
    let isValid = true
    invalidated.render(12, { isStillRendered: () => isValid })
    if (stage === 'before-subscription') isValid = false
    await invalidated.status('SUBSCRIBED', { flushFrames: false })
    if (stage === 'before-frame') isValid = false
    await invalidated.settle()
    assert.equal(
      invalidated.reports.length,
      0,
      `render invalidation ${stage} must prevent a stale ACK`,
    )
    invalidated.close()
  }

  const rapidPages = await createHarness()
  await rapidPages.status('SUBSCRIBED')
  let page12StillRendered = true
  rapidPages.render(12, { isStillRendered: () => page12StillRendered })
  assert.equal(rapidPages.reports.length, 1)
  await rapidPages.snapshot({ currentPdfPage: 11 })
  page12StillRendered = false // A new request clears/reuses the real canvas.
  await rapidPages.snapshot({ currentPdfPage: 12 })
  assert.equal(
    rapidPages.reports.length,
    1,
    'A -> B -> A during redraw must not ACK the previous A canvas proof',
  )
  rapidPages.render(12)
  assert.equal(rapidPages.reports.length, 2)
  rapidPages.close()

  verifyViewerProof()

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        cases: [
          'PDF before SUBSCRIBED reports ACK without navigation',
          'SUBSCRIBED before PDF does not report ACK prematurely',
          'non-page snapshot and reconnect retain valid canvas proof',
          'lecture/document/version/manifest/page mismatch and cleanup reject ACK',
          'invalidated proof before subscription/frame and rapid A-B-A reject ACK',
          'actual viewer source predicate fences DOM/request/source/PDF/metadata/page',
        ],
        limitation:
          'Deterministic hooks and transport doubles; no React DOM/PDF/device/Hosted acceptance',
      },
      null,
      2,
    ),
  )
}

function verifyViewerProof() {
  const viewerPath = path.join(
    checkout,
    'src/components/DisplayView/SyncedPdfViewer.tsx',
  )
  const viewerSource = fs.readFileSync(viewerPath, 'utf8')
  const syntax = ts.createSourceFile(
    viewerPath,
    viewerSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const definitions = new Map()
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (['isCurrentRequest', 'isStillRendered'].includes(node.name.text)) {
        definitions.set(node.name.text, node.initializer.getText(syntax))
      }
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'isSameDisplayRenderMetadata'
    ) {
      definitions.set(
        node.name.text,
        ts.transpileModule(node.getText(syntax), {
          compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText,
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
  const metadata = {
    documentId: 'document',
    documentVersion: 'version',
    lectureSessionId: lessonId,
    manifestVersion: 1,
  }
  const canvas = { isConnected: true, width: 100, height: 50 }
  const stage = { isConnected: true }
  const pdf = {}
  const context = {
    canvas,
    stage,
    pdfDocument: pdf,
    pageNumber: 12,
    requestId: 7,
    canvasRef: { current: canvas },
    stageRef: { current: stage },
    renderRequestRef: { current: 7 },
    renderDisplayMetadata: metadata,
    displayRenderMetadataRef: { current: { ...metadata } },
    loadedPdfDocumentRef: { current: pdf },
    renderSource: { assetUrl: 'synthetic:source', pdfLoadAttempt: 0 },
    renderSourceRef: {
      current: { assetUrl: 'synthetic:source', pdfLoadAttempt: 0 },
    },
    remotePageRef: { current: 12 },
  }
  context.isSameDisplayRenderMetadata = vm.runInNewContext(
    `${definitions.get('isSameDisplayRenderMetadata')}\nisSameDisplayRenderMetadata`,
    context,
  )
  context.isCurrentRequest = vm.runInNewContext(
    definitions.get('isCurrentRequest'),
    context,
  )
  const isStillRendered = vm.runInNewContext(
    definitions.get('isStillRendered'),
    context,
  )
  assert.equal(isStillRendered(), true)
  const failures = [
    [canvas, 'isConnected', false],
    [stage, 'isConnected', false],
    [canvas, 'width', 0],
    [canvas, 'height', 0],
    [context.canvasRef, 'current', {}],
    [context.stageRef, 'current', {}],
    [context.renderRequestRef, 'current', 8],
    [context.loadedPdfDocumentRef, 'current', {}],
    [context.renderSourceRef.current, 'assetUrl', 'synthetic:replacement'],
    [context.renderSourceRef.current, 'pdfLoadAttempt', 1],
    [context.remotePageRef, 'current', 11],
    ...Object.keys(metadata).map((key) => [
      context.displayRenderMetadataRef.current,
      key,
      key === 'manifestVersion' ? 2 : 'replacement',
    ]),
  ]
  for (const [target, key, value] of failures) {
    const oldValue = target[key]
    target[key] = value
    assert.equal(
      isStillRendered(),
      false,
      `${key} must invalidate canvas proof`,
    )
    target[key] = oldValue
    assert.equal(isStillRendered(), true, `${key} fixture reset`)
  }
  assert.match(
    viewerSource,
    /context\.drawImage\(cached\.canvas, 0, 0\)[\s\S]*?publishDisplayPdfRendered\(\{\s*\.\.\.renderDisplayMetadata,\s*isStillRendered,\s*page: pageNumber/,
  )
  assert.match(
    viewerSource,
    /await renderTask\.promise[\s\S]*?publishDisplayPdfRendered\(\{\s*\.\.\.renderDisplayMetadata,\s*isStillRendered,\s*page: pageNumber/,
  )
}

await main()
