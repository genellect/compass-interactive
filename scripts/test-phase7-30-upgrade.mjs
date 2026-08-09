import { spawnSync } from 'node:child_process'

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this upgrade check through npm.')

function runSupabase(args) {
  const result = spawnSync(
    process.execPath,
    [npmCli, 'exec', '--', 'supabase', ...args],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`supabase ${args.join(' ')} exited with ${result.status}`)
  }
}

let failure
try {
  runSupabase([
    'db',
    'reset',
    '--local',
    '--version',
    '20260809133000',
    '--sql-paths',
    '../scripts/fixtures/phase7-30-upgrade-probe.sql',
  ])
  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-30-upgrade-probe-test.sql',
    '--local',
  ])
} catch (error) {
  failure = error
} finally {
  try {
    runSupabase(['db', 'reset', '--local', '--no-seed'])
  } catch (resetError) {
    failure ??= resetError
  }
}

if (failure) throw failure
console.log(
  'Populated Phase 7.29C legacy Admin sessions upgraded through Phase 7.30 B1 with mode, verifier and revocation contracts intact.',
)
