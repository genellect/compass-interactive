import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const target = resolve(root, 'src', 'types', 'database.ts')
const executable = resolve(
  root,
  'node_modules',
  'supabase',
  'dist',
  'supabase.js',
)
const result = spawnSync(
  process.execPath,
  [
    executable,
    'gen',
    'types',
    '--lang',
    'typescript',
    '--local',
    '--schema',
    'public',
  ],
  { cwd: root, encoding: 'utf8', windowsHide: true },
)

if (result.status !== 0 || !result.stdout.trim()) {
  process.stderr.write(result.stderr || 'Supabase type generation failed.\n')
  process.exit(result.status || 1)
}

const normalize = (value) => value.replace(/\r\n/g, '\n').trimEnd() + '\n'
const generated = normalize(result.stdout)

if (process.argv.includes('--write')) {
  writeFileSync(target, generated, 'utf8')
  console.log('Generated public database types from local Supabase.')
  process.exit(0)
}

const committed = normalize(readFileSync(target, 'utf8'))
if (committed !== generated) {
  console.error(
    'Generated database types differ. Run npm run db:types:generate after applying all migrations.',
  )
  process.exit(1)
}

console.log('Generated database types are deterministic and current.')
