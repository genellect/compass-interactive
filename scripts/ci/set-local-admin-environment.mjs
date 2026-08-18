import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const environmentId = process.argv[2]?.trim() ?? ''
if (!UUID_PATTERN.test(environmentId)) {
  throw new Error(
    'Usage: node scripts/ci/set-local-admin-environment.mjs <environment UUID>',
  )
}

const runnerTemp = process.env.RUNNER_TEMP?.trim() ?? ''
if (!runnerTemp) throw new Error('RUNNER_TEMP is required.')

const envPath = join(runnerTemp, 'compass-edge.env')
const source = readFileSync(envPath, 'utf8')
const matches = source.match(/^PHASE730_ADMIN_ENVIRONMENT_ID=.*$/gm)
if (matches?.length !== 1) {
  throw new Error(
    'The synthetic Admin Edge environment ID must appear exactly once.',
  )
}

const next = source.replace(
  /^PHASE730_ADMIN_ENVIRONMENT_ID=.*$/m,
  `PHASE730_ADMIN_ENVIRONMENT_ID=${environmentId}`,
)
writeFileSync(envPath, next, { encoding: 'utf8', mode: 0o600 })
