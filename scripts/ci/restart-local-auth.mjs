import { spawnSync } from 'node:child_process'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 30_000,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.stderr.trim()}`,
    )
  }
  return result.stdout.trim()
}

const containers = run('docker', [
  'ps',
  '--all',
  '--filter',
  'name=^/supabase_auth_',
  '--format',
  '{{.Names}}',
])
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean)

if (
  containers.length !== 1 ||
  !/^supabase_auth_[A-Za-z0-9_.-]+$/.test(containers[0])
) {
  throw new Error(
    `Expected exactly one local Supabase Auth container; found ${containers.length}.`,
  )
}

const container = containers[0]
run('docker', ['restart', container])
const state = run('docker', [
  'inspect',
  '--format',
  '{{.State.Status}}',
  container,
])
if (state !== 'running') {
  throw new Error(`Local Supabase Auth restart ended in state: ${state}`)
}

console.log('Local Supabase Auth container restarted after database reset.')
