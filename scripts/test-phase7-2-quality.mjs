import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/phase7-2-academic-quality.json', import.meta.url),
    'utf8',
  ),
)
const verifiedCatalog = new Map([
  [
    'pmid:26551272',
    {
      doi: '10.1056/NEJMoa1511939',
      pmid: '26551272',
      title: 'A Randomized Trial of Intensive versus Standard Blood-Pressure Control',
    },
  ],
  [
    'pmid:31535829',
    {
      doi: '10.1056/NEJMoa1911303',
      pmid: '31535829',
      title: 'Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction',
    },
  ],
  [
    'pmid:32678530',
    {
      doi: '10.1056/NEJMoa2021436',
      pmid: '32678530',
      title: 'Dexamethasone in Hospitalized Patients with Covid-19',
    },
  ],
])

let validIdentifiers = 0
for (const source of fixture.sources) {
  assert.match(source.sourceId, /^pmid:[0-9]{1,9}$/)
  assert.match(source.pmid, /^[0-9]{1,9}$/)
  assert.match(source.doi, /^10\.[0-9]{4,9}\/\S+$/)
  assert.equal(source.sourceId, `pmid:${source.pmid}`)
  assert.deepEqual(
    { doi: source.doi, pmid: source.pmid, title: source.title },
    verifiedCatalog.get(source.sourceId),
  )
  validIdentifiers += 1
}

let supportedClaims = 0
for (const claim of fixture.reviewedClaims) {
  assert.ok(verifiedCatalog.has(claim.sourceId), 'claim must map to a verified source')
  assert.equal(typeof claim.text, 'string')
  assert.ok(claim.text.length >= 20)
  if (claim.supported === true) supportedClaims += 1
}

const identifierValidity = validIdentifiers / fixture.sources.length
const reviewedClaimSupport = supportedClaims / fixture.reviewedClaims.length
assert.equal(identifierValidity, 1)
assert.ok(reviewedClaimSupport >= 0.95)
assert.equal(fixture.reviewedClaims.length, 20)

console.log(
  JSON.stringify(
    {
      identifierValidity,
      reviewedClaimCount: fixture.reviewedClaims.length,
      reviewedClaimSupport,
      scope: 'deterministic curated regression; human UI approval remains a separate gate',
    },
    null,
    2,
  ),
)
