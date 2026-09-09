import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const categories = [
  ['deadlock', /deadlock detected|\b40P01\b/i],
  ['serialization-failure', /could not serialize access|\b40001\b/i],
  ['query-canceled', /statement timeout|\b57014\b/i],
  ['lock-not-available', /lock timeout|\b55P03\b/i],
  [
    'stale-type-cache',
    /cache lookup failed for type|cached plan must not change result type/i,
  ],
  ['schema-cache', /\bPGRST20[0-5]\b/i],
  [
    'connection-unavailable',
    /too many clients|connection refused|connection reset|terminating connection|\b(?:53300|57P01|08006|PGRST00[0-3])\b/i,
  ],
]

// Keep only fixed categories and timestamps. SQL, parameters, headers, tokens,
// identities and raw error messages must never enter the public CI artifact.
export function summarizeLocalErrors(logText) {
  const events = []
  let matchedLines = 0
  for (const line of logText.split(/\r?\n/)) {
    const matches = categories.filter(([, pattern]) => pattern.test(line))
    if (matches.length === 0 && !/\b(?:ERROR|FATAL|PANIC)\b/.test(line))
      continue
    matchedLines += 1
    if (events.length === 100) events.shift()
    events.push({
      timestamp:
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/.exec(line)?.[0] ??
        null,
      categories:
        matches.length > 0
          ? matches.map(([name]) => name)
          : ['unclassified-error'],
    })
  }
  return { matchedLines, events, truncated: matchedLines > events.length }
}

function docker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      'Local diagnostic Docker command failed; raw output withheld.',
    )
  }
  return `${result.stdout}\n${result.stderr}`.trim()
}

export function collectLocalFailureDiagnostics(runDocker = docker) {
  const names = runDocker([
    'ps',
    '--all',
    '--filter',
    'name=^/supabase_(db|rest)_',
    '--format',
    '{{.Names}}',
  ])
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
  const database = names.filter((name) =>
    /^supabase_db_[A-Za-z0-9_.-]+$/.test(name),
  )
  if (
    names.length !== 2 ||
    database.length !== 1 ||
    !names.includes(database[0].replace('supabase_db_', 'supabase_rest_'))
  ) {
    throw new Error(
      'Expected one local database and REST pair from the same project.',
    )
  }
  return Object.fromEntries(
    ['db', 'rest'].map((role) => {
      const name = database[0].replace('supabase_db_', `supabase_${role}_`)
      try {
        const logs = runDocker([
          'logs',
          '--timestamps',
          '--since',
          '30m',
          '--tail',
          '4000',
          name,
        ])
        return [role, { capture: 'complete', ...summarizeLocalErrors(logs) }]
      } catch {
        return [role, { capture: 'unavailable' }]
      }
    }),
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const runnerTemp = process.env.RUNNER_TEMP?.trim() ?? ''
  if (process.env.CI !== 'true' || !isAbsolute(runnerTemp)) {
    throw new Error('Diagnostics require CI and an absolute RUNNER_TEMP.')
  }
  const report = collectLocalFailureDiagnostics()
  writeFileSync(
    join(runnerTemp, 'compass-local-failure-diagnostics.json'),
    JSON.stringify(report, null, 2),
    { flag: 'wx' },
  )
  console.log(
    'Saved local database and REST error categories; raw logs withheld.',
  )
}
