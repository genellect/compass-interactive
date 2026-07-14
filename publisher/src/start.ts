import { join } from 'node:path'
import {
  R2S3ObjectStore,
  loadR2PublisherConfiguration,
} from './cloudflare/r2S3ObjectStore.ts'
import {
  createPublisherServer,
  getDefaultPublisherDataRoot,
  loadPublisherServerConfiguration,
} from './server/publisherServer.ts'
import { syncLocalRetention } from './retention/syncLocalRetention.ts'
import { FileObjectStore } from './storage/fileObjectStore.ts'
import { LocalTextStore } from './storage/localTextStore.ts'

const configuration = loadPublisherServerConfiguration()
const dataRoot = getDefaultPublisherDataRoot()
const objectStore =
  process.env.COMPASS_PUBLISHER_OBJECT_STORE === 'r2'
    ? new R2S3ObjectStore(loadR2PublisherConfiguration())
    : new FileObjectStore(join(dataRoot, 'fake-r2'))
const textStore = new LocalTextStore(join(dataRoot, 'extracted-text'))
const retentionFeedUrl = process.env.COMPASS_PDF_RETENTION_FEED_URL ?? ''
const retentionSecret = process.env.COMPASS_PDF_RETENTION_SYNC_SECRET ?? ''
if (
  process.env.COMPASS_PUBLISHER_OBJECT_STORE === 'r2' &&
  (!retentionFeedUrl ||
    new TextEncoder().encode(retentionSecret).byteLength < 32)
) {
  throw new Error(
    'R2 Publisher requires the retention feed URL and 32-byte secret.',
  )
}
const { server, sessions } = createPublisherServer({
  configuration,
  objectStore,
  textStore,
})

server.listen(configuration.port, configuration.host, () => {
  console.log(
    `COMPASS PDF Publisher: http://${configuration.host}:${configuration.port}`,
  )
  console.log(`Pairing code: ${sessions.pairingCode}`)
  console.log(
    `Pairing expires: ${new Date(sessions.pairingExpiresAt).toISOString()}`,
  )
})

async function runRetentionCycle() {
  try {
    if (retentionFeedUrl && retentionSecret) {
      await syncLocalRetention({
        feedUrl: retentionFeedUrl,
        secret: retentionSecret,
        textStore,
      })
    }
    const deleted = await textStore.cleanupDue()
    if (deleted > 0)
      console.log(`Local extraction cleanup removed ${deleted} file(s).`)
  } catch (error) {
    console.error(
      `Local extraction retention failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    )
  }
}

void runRetentionCycle()
setInterval(() => void runRetentionCycle(), 60 * 60 * 1000).unref()
