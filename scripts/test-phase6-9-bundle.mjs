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
  adminJs: { actual: largest('AdminPage-', '.js'), limit: 92_109 },
  appCss: { actual: largest('index-', '.css'), limit: 88_449 },
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
  'Phase 6.9 bundle sizes remain within 110% of the Phase 6.8 baseline.',
)
