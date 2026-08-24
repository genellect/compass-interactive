import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const assets = resolve(import.meta.dirname, '..', 'dist', 'assets')
const files = readdirSync(assets).map((name) => ({
  name,
  size: statSync(resolve(assets, name)).size,
}))
const largest = (prefix, suffix) =>
  Math.max(
    ...files
      .filter(
        (file) => file.name.startsWith(prefix) && file.name.endsWith(suffix),
      )
      .map((file) => file.size),
  )

const budgets = {
  // The Phase 7.30 identity gate keeps the existing Admin workspace in the
  // lazy Google-only Admin workspace chunk. Preserve the approved budget.
  adminJs: { actual: largest('AdminWorkspaceApp-', '.js'), limit: 108_707 },
  // The final projector and teacher UX ships 95,674 bytes of app CSS; allow
  // 1% drift while keeping the production stylesheet under 100 KiB.
  appCss: { actual: largest('index-', '.css'), limit: 96_631 },
  indexJs: { actual: largest('index-', '.js'), limit: 529_742 },
  pdfJs: { actual: largest('SyncedPdfViewer-', '.js'), limit: 479_617 },
}
for (const [name, budget] of Object.entries(budgets)) {
  assert.ok(Number.isFinite(budget.actual), `${name} asset is missing`)
  assert.ok(
    budget.actual <= budget.limit,
    `${name} ${budget.actual} exceeds ${budget.limit}`,
  )
}
console.log(JSON.stringify(budgets, null, 2))
console.log(
  'Phase 6.9 bundle sizes remain within their documented production budgets.',
)
