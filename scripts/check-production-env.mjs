import process from 'node:process'
import { loadEnv } from 'vite'
import {
  productionFeatureFlags,
  validateProductionEnvironment,
} from './productionEnvironment.mjs'

const environment = {
  ...loadEnv('production', process.cwd(), ''),
  ...process.env,
}
const errors = validateProductionEnvironment(environment)

if (errors.length > 0) {
  console.error('Production environment check failed:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

const enabledFlags = productionFeatureFlags.filter(
  (name) => environment[name]?.trim() === 'true',
)
console.log(
  `Production environment check passed. Enabled feature flags: ${
    enabledFlags.length > 0 ? enabledFlags.join(', ') : 'none'
  }.`,
)
