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
  runSupabase([
    'db',
    'reset',
    '--local',
    '--version',
    '20260809143000',
    '--sql-paths',
    '../scripts/fixtures/phase7-30b2-upgrade-probe.sql',
  ])
  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-30b2-upgrade-probe-test.sql',
    '--local',
  ])
  runSupabase([
    'db',
    'reset',
    '--local',
    '--version',
    '20260809155129',
    '--sql-paths',
    '../scripts/fixtures/phase7-30b22a-b2-head-upgrade-probe.sql',
  ])
  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-30b22a-b2-head-upgrade-probe-test.sql',
    '--local',
  ])
  runSupabase([
    'db',
    'reset',
    '--local',
    '--version',
    '20260809231342',
    '--sql-paths',
    '../scripts/fixtures/phase7-30b22b-b22a-head-upgrade-probe.sql',
  ])
  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-30b22b-b22a-head-upgrade-probe-test.sql',
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
  'Populated legacy, B1, B2 and B2.2a-head states upgrade through Phase 7.30 B2.2b with explicit trust anchors, no browser-binding inference, eight-hour cap and dormant gates intact.',
)
