import { runSupabaseCommand } from './lib/run-supabase-command.mjs'

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this upgrade check through npm.')

function runSupabase(args) {
  runSupabaseCommand({ npmCli, args })
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
  runSupabase([
    'db',
    'reset',
    '--local',
    '--version',
    '20260812033000',
    '--sql-paths',
    '../scripts/fixtures/phase7-30e-c2-head-upgrade-probe.sql',
  ])
  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-30e-c2-head-upgrade-probe-test.sql',
    '--local',
  ])
  runSupabase([
    'db',
    'reset',
    '--local',
    '--version',
    '20260812043000',
    '--sql-paths',
    '../scripts/fixtures/phase7-30e-d-head-upgrade-probe.sql',
  ])
  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-30e-d-head-upgrade-probe-test.sql',
    '--local',
  ])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-30f-e-head-upgrade-probe-test.sql',
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
  'Populated legacy, B1, B2, B2.2a-head, B2.2b-head, C1-head, C2-head and D-head states upgrade through Phase 7.30G with exact Display terminal binding, Google-create ownership provenance, explicit trust anchors, invitation lifecycle evidence, complete Owner capability, no ownership/browser/receipt inference, eight-hour cap, dormant cutover gates and the operator-only observational readiness preflight intact.',
)
