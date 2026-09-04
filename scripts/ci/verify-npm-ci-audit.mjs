const chunks = []

for await (const chunk of process.stdin) {
  chunks.push(chunk)
}

const input = Buffer.concat(chunks).toString('utf8').trim()
let report

try {
  report = JSON.parse(input)
} catch {
  console.error('npm ci audit gate failed: npm did not return valid JSON.')
  process.exit(1)
}

const vulnerabilities = report?.audit?.vulnerabilities
const severities = ['info', 'low', 'moderate', 'high', 'critical', 'total']

if (
  !vulnerabilities ||
  severities.some(
    (severity) =>
      !Number.isInteger(vulnerabilities[severity]) ||
      vulnerabilities[severity] < 0,
  )
) {
  console.error(
    'npm ci audit gate failed: the registry audit result was unavailable.',
  )
  process.exit(1)
}

const { critical, high, low, moderate, total } = vulnerabilities
console.log(
  `npm ci audit result: ${total} total (${critical} critical, ${high} high, ${moderate} moderate, ${low} low).`,
)

if (high + critical > 0) {
  console.error('npm ci audit gate failed: high or critical findings exist.')
  process.exit(1)
}

console.log('npm ci audit gate passed.')
