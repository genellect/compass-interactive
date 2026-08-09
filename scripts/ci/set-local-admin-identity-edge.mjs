import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const requested = process.argv[2]
if (!['off', 'on'].includes(requested)) {
  throw new Error(
    'Usage: node scripts/ci/set-local-admin-identity-edge.mjs <on|off>',
  )
}

const runnerTemp = process.env.RUNNER_TEMP?.trim() ?? ''
if (!runnerTemp) throw new Error('RUNNER_TEMP is required.')

const envPath = join(runnerTemp, 'compass-edge.env')
const source = readFileSync(envPath, 'utf8')
const matches = source.match(/^PHASE730_ADMIN_IDENTITY_ENABLED=(false|true)$/gm)
if (matches?.length !== 1) {
  throw new Error(
    'The synthetic Admin identity Edge flag must appear exactly once.',
  )
}

const next = source.replace(
  /^PHASE730_ADMIN_IDENTITY_ENABLED=(false|true)$/m,
  `PHASE730_ADMIN_IDENTITY_ENABLED=${requested === 'on' ? 'true' : 'false'}`,
)
writeFileSync(envPath, next, { encoding: 'utf8', mode: 0o600 })
