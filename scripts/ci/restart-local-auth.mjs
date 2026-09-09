import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

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

export function restartLocalAuthAndGateway(runCommand = run) {
  const containers = runCommand('docker', [
    'ps',
    '--all',
    '--filter',
    'name=^/supabase_(auth|kong)_',
    '--format',
    '{{.Names}}',
  ])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)

  const auth = containers.filter((name) => name.startsWith('supabase_auth_'))
  const gateway = containers.filter((name) => name.startsWith('supabase_kong_'))
  if (
    containers.length !== 2 ||
    auth.length !== 1 ||
    gateway.length !== 1 ||
    !/^supabase_auth_[A-Za-z0-9_.-]+$/.test(auth[0]) ||
    gateway[0] !== auth[0].replace('supabase_auth_', 'supabase_kong_')
  ) {
    throw new Error(
      'Expected one local Supabase Auth and gateway pair from the same project.',
    )
  }

  // db reset can move Auth to another IP while Kong retains the old upstream.
  // Restart Kong after Auth; a bare reload can lose its custom email template listener.
  // See supabase/cli#6016 and supabase/cli#5905. The HTTP health gate still runs next.
  for (const container of [auth[0], gateway[0]]) {
    runCommand('docker', ['restart', container])
    const state = runCommand('docker', [
      'inspect',
      '--format',
      '{{.State.Status}}',
      container,
    ])
    if (state !== 'running') {
      throw new Error(
        `Local Supabase ${container} restart ended in state: ${state}`,
      )
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  restartLocalAuthAndGateway()
  console.log('Local Supabase Auth and gateway restarted after database reset.')
}
