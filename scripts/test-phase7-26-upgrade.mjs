import { runSupabaseCommand } from './lib/run-supabase-command.mjs'

const npmCli = process.env.npm_execpath
if (!npmCli) {
  throw new Error('Run this upgrade check through npm.')
}

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
    '20260720065403',
    '--sql-paths',
    '../scripts/fixtures/phase7-26-upgrade-probe.sql',
  ])
  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-26-upgrade-probe-test.sql',
    '--local',
  ])
} catch (error) {
  failure = error
} finally {
  runSupabase(['db', 'reset', '--local', '--no-seed'])
}

if (failure) throw failure
console.log('Phase 7.2 data upgraded through Phase 7.26 and was preserved.')
