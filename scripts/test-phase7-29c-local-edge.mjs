import assert from 'node:assert/strict'
import {
  createHmac,
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
} from 'node:crypto'
import { spawn } from 'node:child_process'

const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const tokenSecret = process.env.PRESENTER_BRIDGE_TOKEN_SECRET?.trim() ?? ''
const gatewaySecret = process.env.PRESENTER_BRIDGE_GATEWAY_SECRET?.trim() ?? ''
const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'

assert.ok(supabaseUrl, 'VITE_SUPABASE_URL is required')
assert.ok(
  tokenSecret.length >= 32,
  'A synthetic Presenter token secret is required',
)
assert.ok(
  gatewaySecret.length >= 32,
  'A synthetic Presenter gateway secret is required',
)
const parsedUrl = new URL(supabaseUrl)
assert.ok(
  ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname),
  'The enabled Presenter integration test refuses non-local Supabase URLs.',
)

const endpoint = `${supabaseUrl}/functions/v1/presenter-bridge-session`
const adminSessionId = randomUUID()
const adminAuthUserId = randomUUID()
const lectureKeyHash = randomBytes(32).toString('hex')
const lectureCode = String(randomInt(100_000, 1_000_000))
const manualCode = 'ABCD2345'
const ticketJtiHash = randomBytes(32).toString('hex')
const pdfHash = randomBytes(32).toString('hex')
const textHash = randomBytes(32).toString('hex')
const pptxHash = randomBytes(32).toString('hex')
const slideOrderHash = randomBytes(32).toString('hex')
const trustedNetwork = sha256Hex('local-presenter-network')

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
        '-q',
        '-t',
        '-A',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        sql,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `psql exited with ${code}`))
    })
  })
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function presenterHash(value, domain) {
  return createHmac('sha256', tokenSecret)
    .update(`${domain}:${value}`)
    .digest('hex')
}

const signingPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)
const publicKeySpki = new Uint8Array(
  await crypto.subtle.exportKey('spki', signingPair.publicKey),
)
const keyId = sha256Hex(publicKeySpki)

async function signedEnvelope(body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const nonceBytes = randomBytes(24)
  const nonce = base64Url(nonceBytes)
  const canonical = [
    'v1',
    'POST',
    'compass-presenter-session-v1',
    '/functions/v1/presenter-bridge-session',
    timestamp,
    nonce,
    sha256Hex(payload),
  ].join('\n')
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { hash: 'SHA-256', name: 'ECDSA' },
      signingPair.privateKey,
      Buffer.from(canonical, 'utf8'),
    ),
  )
  assert.equal(signature.byteLength, 64)
  return {
    headers: {
      'Content-Type': 'application/json',
      'x-compass-presenter-gateway': gatewaySecret,
      'x-compass-presenter-key-id': keyId,
      'x-compass-presenter-network': trustedNetwork,
      'x-compass-presenter-nonce': nonce,
      'x-compass-presenter-public-key': base64Url(publicKeySpki),
      'x-compass-presenter-signature': base64Url(signature),
      'x-compass-presenter-timestamp': timestamp,
    },
    payload,
  }
}

async function invoke(envelope, expectedStatus) {
  const response = await fetch(endpoint, {
    body: envelope.payload,
    headers: envelope.headers,
    method: 'POST',
    redirect: 'manual',
  })
  const body = await response.json()
  assert.equal(response.status, expectedStatus, JSON.stringify(body))
  assert.match(response.headers.get('cache-control') ?? '', /no-store/i)
  return body
}

let lectureId = null
let connectionId = null
let failure

try {
  lectureId = await runSql(`
    select public.admin_create_lecture(
      'Phase 7.29C local Edge integration',
      ${sqlLiteral(lectureKeyHash)},
      ${sqlLiteral(lectureCode)},
      null,
      null
    );
  `)
  assert.match(lectureId, /^[0-9a-f-]{36}$/i)

  await runSql(`
    insert into public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash,
      issued_at, last_seen_at, idle_expires_at, expires_at
    ) values (
      ${sqlLiteral(adminSessionId)}::uuid,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(adminAuthUserId)}::uuid,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      statement_timestamp() - interval '1 minute',
      statement_timestamp(),
      statement_timestamp() + interval '1 hour',
      statement_timestamp() + interval '2 hours'
    );
    select public.admin_set_lecture_status(
      ${sqlLiteral(lectureId)}::uuid,
      'start',
      null
    );
    select public.admin_register_pdf_document(
      ${sqlLiteral(lectureId)}::uuid,
      'phase729c-local-edge-doc',
      ${sqlLiteral(pdfHash)},
      1,
      'Phase 7.29C local Edge material',
      3,
      3000,
      300,
      ${sqlLiteral(pdfHash)},
      ${sqlLiteral(textHash)},
      true
    );
    select public.admin_update_pdf_display_v3(
      ${sqlLiteral(lectureId)}::uuid,
      'phase729c-local-edge-doc',
      ${sqlLiteral(pdfHash)},
      1,
      3,
      true,
      1,
      'normal'
    );
    select public.set_presenter_runtime_v1(true);
  `)

  const issueOutput = await runSql(`
    select public.issue_presenter_connection_v2(
      ${sqlLiteral(lectureId)}::uuid,
      ${sqlLiteral(adminSessionId)}::uuid,
      ${sqlLiteral(adminAuthUserId)}::uuid,
      ${sqlLiteral(ticketJtiHash)},
      ${sqlLiteral(presenterHash(manualCode, 'manual-code'))},
      statement_timestamp() + interval '55 seconds',
      statement_timestamp() + interval '5 minutes'
    ) ->> 'connection_id';
  `)
  connectionId = issueOutput
  assert.match(connectionId, /^[0-9a-f-]{36}$/i)

  const inspectEnvelope = await signedEnvelope({
    action: 'inspect',
    connectionId,
    customShowActive: false,
    hiddenSlideCount: 0,
    installationHash: keyId,
    manualCode,
    pptxFileSha256: pptxHash,
    slideCount: 3,
    slideIdOrderSha256: slideOrderHash,
  })
  const inspect = await invoke(inspectEnvelope, 200)
  assert.equal(inspect.ok, true)
  assert.equal(inspect.state, 'inspected')
  assert.deepEqual(await invoke(inspectEnvelope, 200), inspect)

  const pendingClaimEnvelope = await signedEnvelope({
    action: 'claim',
    connectionId,
    installationHash: keyId,
    manualCode,
  })
  const pendingClaim = await invoke(pendingClaimEnvelope, 409)
  assert.equal(pendingClaim.code, 'confirmation_pending')
  assert.deepEqual(await invoke(pendingClaimEnvelope, 409), pendingClaim)

  await runSql(`
    select public.confirm_presenter_connection_v1(
      ${sqlLiteral(connectionId)}::uuid,
      ${sqlLiteral(adminSessionId)}::uuid,
      ${sqlLiteral(adminAuthUserId)}::uuid
    );
  `)
  assert.deepEqual(
    await invoke(pendingClaimEnvelope, 409),
    pendingClaim,
    'an exact negative replay must stay cached after business state changes',
  )

  const claim = await invoke(
    await signedEnvelope({
      action: 'claim',
      connectionId,
      installationHash: keyId,
      manualCode,
    }),
    200,
  )
  assert.equal(claim.ok, true)
  assert.equal(claim.state, 'active')
  assert.equal(typeof claim.capabilityToken, 'string')

  const reusedCredential = await invoke(
    await signedEnvelope({
      action: 'claim',
      connectionId,
      installationHash: keyId,
      manualCode,
    }),
    401,
  )
  assert.equal(reusedCredential.code, 'credential_invalid')

  const reinspectedCredential = await invoke(
    await signedEnvelope({
      action: 'inspect',
      connectionId,
      customShowActive: false,
      hiddenSlideCount: 0,
      installationHash: keyId,
      manualCode,
      pptxFileSha256: pptxHash,
      slideCount: 3,
      slideIdOrderSha256: slideOrderHash,
    }),
    401,
  )
  assert.equal(reinspectedCredential.code, 'credential_invalid')

  const wrongIdReinspection = await invoke(
    await signedEnvelope({
      action: 'inspect',
      connectionId: randomUUID(),
      customShowActive: false,
      hiddenSlideCount: 0,
      installationHash: keyId,
      manualCode,
      pptxFileSha256: pptxHash,
      slideCount: 3,
      slideIdOrderSha256: slideOrderHash,
    }),
    401,
  )
  assert.equal(wrongIdReinspection.code, 'credential_invalid')

  const updateEnvelope = await signedEnvelope({
    action: 'update',
    capabilityToken: claim.capabilityToken,
    eventId: randomUUID(),
    pdfPage: 2,
    pptxFileSha256: pptxHash,
    sequence: 0,
    slideId: 2,
    slideIdOrderSha256: slideOrderHash,
    slideIndex: 2,
  })
  const update = await invoke(updateEnvelope, 200)
  assert.equal(update.ok, true)
  assert.deepEqual(await invoke(updateEnvelope, 200), update)

  const heartbeat = await invoke(
    await signedEnvelope({
      action: 'heartbeat',
      capabilityToken: claim.capabilityToken,
      pptxFileSha256: pptxHash,
      slideIdOrderSha256: slideOrderHash,
    }),
    200,
  )
  assert.equal(heartbeat.ok, true)

  const disconnect = await invoke(
    await signedEnvelope({
      action: 'disconnect',
      capabilityToken: claim.capabilityToken,
    }),
    200,
  )
  assert.equal(disconnect.ok, true)

  const finalState = await runSql(`
    select jsonb_build_object(
      'revoked', revoked_at is not null,
      'reason', revoke_reason,
      'page', last_committed_pdf_page,
      'sequence', last_sequence
    )
    from public.presenter_connections
    where id = ${sqlLiteral(connectionId)}::uuid;
  `)
  assert.deepEqual(JSON.parse(finalState), {
    page: 2,
    reason: 'disconnected',
    revoked: true,
    sequence: 0,
  })

  console.log(
    'Phase 7.29C enabled local Edge integration passed without exposing credentials.',
  )
} catch (error) {
  failure = error
} finally {
  try {
    await runSql(`
      select public.set_presenter_runtime_v1(false)
      where to_regprocedure('public.set_presenter_runtime_v1(boolean)') is not null;
      delete from private.presenter_request_receipts
      where proof_key_id = ${sqlLiteral(keyId)};
      delete from private.presenter_machine_rate_limits
      where bucket_hash in (
        ${sqlLiteral(presenterHash('compass-presenter-machine-endpoint', 'presenter-rate-global'))},
        ${sqlLiteral(presenterHash(trustedNetwork, 'presenter-rate-network'))},
        ${sqlLiteral(presenterHash(keyId, 'presenter-rate-key'))}
      );
      delete from public.presenter_connection_events
      where lecture_session_id = ${lectureId ? `${sqlLiteral(lectureId)}::uuid` : 'null::uuid'};
      delete from public.presenter_connections
      where lecture_session_id = ${lectureId ? `${sqlLiteral(lectureId)}::uuid` : 'null::uuid'};
      delete from public.lecture_pdf_documents
      where lecture_session_id = ${lectureId ? `${sqlLiteral(lectureId)}::uuid` : 'null::uuid'};
      delete from public.lecture_lifecycle_events
      where lecture_session_id = ${lectureId ? `${sqlLiteral(lectureId)}::uuid` : 'null::uuid'};
      delete from public.lecture_ai_control
      where lecture_session_id = ${lectureId ? `${sqlLiteral(lectureId)}::uuid` : 'null::uuid'};
      delete from public.lecture_sessions
      where id = ${lectureId ? `${sqlLiteral(lectureId)}::uuid` : 'null::uuid'};
      delete from public.admin_sessions
      where id = ${sqlLiteral(adminSessionId)}::uuid;
    `)
  } catch (cleanupError) {
    failure ??= cleanupError
  }
}

if (failure) throw failure
