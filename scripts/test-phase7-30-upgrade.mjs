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
  runSupabase([
    'db',
    'reset',
    '--local',
    '--version',
    '20260810113000',
    '--sql-paths',
    '../scripts/fixtures/phase7-30c1-b22b-head-upgrade-probe.sql',
  ])
  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-30c1-b22b-head-upgrade-probe-test.sql',
    '--local',
  ])
  runSupabase([
    'db',
    'reset',
    '--local',
    '--version',
    '20260810160000',
    '--sql-paths',
    '../scripts/fixtures/phase7-30c2-c1-head-upgrade-probe.sql',
  ])
  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-30c2-c1-head-upgrade-probe-test.sql',
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
  'Populated legacy, B1, B2, B2.2a-head, B2.2b-head and C1-head states upgrade through Phase 7.30 C2 with explicit trust anchors, no ownership/browser/receipt inference, eight-hour cap and dormant gates intact.',
)
