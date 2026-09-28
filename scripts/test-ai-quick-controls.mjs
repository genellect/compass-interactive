import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from '@playwright/test'

// Never load project env files or contact a hosted service in this regression.
const root = fileURLToPath(new URL('..', import.meta.url))
console.log(
  `AI component source SHA256: ${createHash('sha256')
    .update(
      readFileSync(
        new URL(
          '../src/components/AdminWorkspace/AdminAiControlPanel.tsx',
          import.meta.url,
        ),
      ),
    )
    .digest('hex')}`,
)
const server = await createServer({
  root,
  configFile: false,
  envDir: fileURLToPath(new URL('./test-fixtures', import.meta.url)),
  plugins: [
    react(),
    {
      name: 'local-ai-harness',
      configureServer(vite) {
        vite.middlewares.use('/__ai-controls-test', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(
            '<div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/scripts/test-fixtures/ai-quick-controls.tsx"></script>',
          )
        })
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0 },
  define: Object.fromEntries(
    [
      'VITE_PHASE1_SYNC_PROTOCOL',
      'VITE_PHASE3_PRIVATE_PDF',
      'VITE_PHASE6_SUMMARIES',
      'VITE_PHASE7_1_CLASSROOM_EXTENSIONS',
      'VITE_PHASE7_2_ACADEMIC_ANSWERS',
      'VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS',
      'VITE_PHASE7_26_BROWSER_PDF_PUBLISHING',
    ].map((name) => [`import.meta.env.${name}`, JSON.stringify('true')]),
  ),
})
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ headless: true })
  const run = async (name, task) => {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue()
        : route.abort(),
    )
    await page.goto(`${origin}__ai-controls-test`)
    await page.getByRole('button', { name: '字幕ON', exact: true }).waitFor()
    await page.waitForFunction(
      () => !document.querySelector('button')?.disabled,
    )
    await task(page)
    assert.deepEqual(errors, [], `${name}: browser errors`)
    await page.close()
    console.log(`PASS ${name}`)
  }
  const calls = (page) => page.evaluate(() => window.aiHarness.calls)
  const bulk = (page) =>
    page.getByRole('button', { name: '字幕以外を一括有効化', exact: true })
  await run(
    'draft-to-open lecture keeps detailed settings reachable through their visible summary',
    async (page) => {
      await page.evaluate(() => window.aiHarness.configure({ draft: true }))
      await page
        .getByRole('button', { name: '講義開始時にAI機能を有効にする' })
        .waitFor({ state: 'visible' })
      const language = page.getByLabel('要約言語')
      await page.evaluate(() => window.aiHarness.configure({ draft: false }))
      await language.waitFor({ state: 'attached' })
      assert.equal(await language.isVisible(), false)
      await page.getByText('AIの詳細', { exact: true }).click()
      await language.waitFor({ state: 'visible' })
      await language.selectOption('en')
      assert.equal(await language.inputValue(), 'en')
      assert.deepEqual(await calls(page), [])
    },
  )
  await run(
    'bulk starts summary, leaves missing material explicit, never requests microphone',
    async (page) => {
      await bulk(page).click()
      await page
        .getByText('要約: 要約と参考回答の自動生成を有効にしました。', {
          exact: true,
        })
        .waitFor()
      await page
        .getByText('資料: 公開資料とAI利用許可を確認してください。', {
          exact: true,
        })
        .waitFor()
      assert.deepEqual(
        (await calls(page)).map((call) => call.name),
        ['authorize', 'summaryStart'],
      )
    },
  )
  await run(
    'shared exclusion prevents duplicate bulk and caption dispatch while authorizing',
    async (page) => {
      await page.evaluate(() => window.aiHarness.configure({ hold: true }))
      await bulk(page).click()
      await page.evaluate(() => {
        for (const button of document.querySelectorAll('button'))
          if (['字幕ON', '字幕以外を一括有効化'].includes(button.textContent)) {
            button.click()
            button.click()
          }
      })
      assert.deepEqual(
        (await calls(page)).map((call) => call.name),
        ['authorize'],
      )
      await page.evaluate(() => window.aiHarness.release())
      await page
        .getByText('要約: 要約と参考回答の自動生成を有効にしました。', {
          exact: true,
        })
        .waitFor()
      assert.deepEqual(
        (await calls(page)).map((call) => call.name),
        ['authorize', 'summaryStart'],
      )
    },
  )
  for (const change of [
    { lectureId: 'lecture-b' },
    { session: 'synthetic-session-b' },
  ]) {
    await run(
      `late authorization cannot start handlers after ${Object.keys(change)[0]} change`,
      async (page) => {
        await page.evaluate(() => window.aiHarness.configure({ hold: true }))
        await bulk(page).click()
        await page.evaluate(
          (value) => window.aiHarness.configure(value),
          change,
        )
        await page.evaluate(() => window.aiHarness.release())
        await page.waitForTimeout(150)
        assert.deepEqual(
          (await calls(page)).map((call) => call.name),
          ['authorize'],
        )
      },
    )
  }
  await run(
    'stop while authorizing revokes late master and never starts children',
    async (page) => {
      await page.evaluate(() => window.aiHarness.configure({ hold: true }))
      await page.getByRole('button', { name: '字幕ON', exact: true }).click()
      await page
        .getByRole('button', { name: 'すべて停止', exact: true })
        .click()
      await page.evaluate(() => window.aiHarness.release())
      await page.getByText('AI機能を停止しました。', { exact: true }).waitFor()
      assert.deepEqual(
        (await calls(page)).map((call) => call.name),
        ['authorize', 'revoke'],
      )
    },
  )
  await run(
    'stop intent survives a lecture switch before authorization settles',
    async (page) => {
      await page.evaluate(() => window.aiHarness.configure({ hold: true }))
      await page.getByRole('button', { name: '字幕ON', exact: true }).click()
      await page
        .getByRole('button', { name: 'すべて停止', exact: true })
        .click()
      await page.evaluate(() =>
        window.aiHarness.configure({ lectureId: 'lecture-b' }),
      )
      await page.evaluate(() => window.aiHarness.release())
      await page.waitForFunction(() =>
        window.aiHarness.calls.some((call) => call.name === 'revoke'),
      )
      assert.deepEqual(await calls(page), [
        {
          name: 'authorize',
          lectureSessionId: 'lecture-a',
          scope: 'all_including_captions',
        },
        { name: 'revoke', lectureSessionId: 'lecture-a' },
      ])
    },
  )
  await run(
    'partial failure is reported without claiming blanket success',
    async (page) => {
      await page.evaluate(() =>
        window.aiHarness.configure({ failSummary: true }),
      )
      await bulk(page).click()
      await page
        .getByText('要約: 開始できませんでした。AIの詳細で確認してください。', {
          exact: true,
        })
        .waitFor()
      await page
        .getByText('資料: 公開資料とAI利用許可を確認してください。', {
          exact: true,
        })
        .waitFor()
    },
  )
  await run(
    'caption-only deployment permits explicit CTA, microphone denial never dispatches provider',
    async (page) => {
      await page.evaluate(() =>
        window.aiHarness.configure({ captionsOnly: true }),
      )
      assert.equal(await bulk(page).isDisabled(), true)
      await page.getByRole('button', { name: '字幕ON', exact: true }).click()
      await page
        .getByText(
          '字幕: 開始できませんでした。マイクとAIの詳細を確認してください。',
          { exact: true },
        )
        .waitFor()
      assert.deepEqual(
        (await calls(page)).map((call) => call.name),
        ['authorize', 'microphone'],
      )
    },
  )
  await run(
    'late microphone result after stop closes tracks before any provider call',
    async (page) => {
      await page.evaluate(() =>
        window.aiHarness.configure({ holdMicrophone: true }),
      )
      await page.getByRole('button', { name: '字幕ON', exact: true }).click()
      await page.waitForFunction(() =>
        window.aiHarness.calls.some((call) => call.name === 'microphone'),
      )
      await page
        .getByRole('button', { name: 'すべて停止', exact: true })
        .click()
      await page.evaluate(() => window.aiHarness.releaseMicrophone())
      await page.waitForFunction(() =>
        window.aiHarness.calls.some((call) => call.name === 'trackStopped'),
      )
      const observed = await calls(page)
      assert.equal(
        observed.filter((call) => call.name === 'captionProvider').length,
        0,
      )
      assert.equal(observed.filter((call) => call.name === 'revoke').length, 1)
    },
  )
  await run(
    'lecture switch during intent cancellation still revokes the original master',
    async (page) => {
      await bulk(page).click()
      await page
        .getByText('要約: 要約と参考回答の自動生成を有効にしました。', {
          exact: true,
        })
        .waitFor()
      await page.evaluate(() =>
        window.aiHarness.configure({ holdIntentCancel: true }),
      )
      await page
        .getByRole('button', { name: 'すべて停止', exact: true })
        .click()
      await page.waitForFunction(() =>
        window.aiHarness.calls.some((call) => call.name === 'intentCancelHeld'),
      )
      await page.evaluate(() =>
        window.aiHarness.configure({ lectureId: 'lecture-b' }),
      )
      await page.evaluate(() => window.aiHarness.releaseIntentCancel())
      await page.waitForFunction(() =>
        window.aiHarness.calls.some((call) => call.name === 'revoke'),
      )
      assert.deepEqual(
        (await calls(page)).filter((call) => call.name === 'revoke'),
        [{ name: 'revoke', lectureSessionId: 'lecture-a' }],
      )
    },
  )
} finally {
  await browser?.close()
  await server.close()
}
