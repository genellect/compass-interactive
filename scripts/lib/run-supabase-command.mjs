import { spawnSync } from 'node:child_process'

const isLocalDatabaseReset = (args) =>
  args[0] === 'db' && args[1] === 'reset' && args.includes('--local')

export function runSupabaseCommand({
  npmCli,
  args,
  cwd = process.cwd(),
  env = process.env,
  stdio = 'inherit',
  spawn = spawnSync,
}) {
  const maxAttempts = isLocalDatabaseReset(args) ? 2 : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawn(
      process.execPath,
      [npmCli, 'exec', '--', 'supabase', ...args],
      { cwd, env, stdio },
    )
    if (result.error) throw result.error
    if (result.status === 0) return
    if (attempt < maxAttempts) {
      console.warn(
        'Local Supabase database reset failed; retrying once on the same runner.',
      )
      continue
    }
    throw new Error(`supabase ${args.join(' ')} exited with ${result.status}`)
  }
}
