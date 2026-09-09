import assert from 'node:assert/strict'
import test from 'node:test'
import { restartLocalAuthAndGateway } from './restart-local-auth.mjs'

const auth = 'supabase_auth_compass-ci'
const gateway = 'supabase_kong_compass-ci'

function dockerFixture({
  names = [auth, gateway],
  failedRestart,
  stoppedAfterRestart,
} = {}) {
  const restarts = []
  let authAddress = 1
  let gatewayAddress = 1
  const run = (command, args) => {
    assert.equal(command, 'docker')
    switch (args[0]) {
      case 'ps':
        return names.join('\n')
      case 'restart': {
        const container = args[1]
        assert.ok(
          names.includes(container),
          'must never restart an undiscovered container',
        )
        restarts.push(container)
        if (container === failedRestart) throw new Error('restart failed')
        if (container === auth) authAddress += 1
        if (container === gateway) gatewayAddress = authAddress
        return container
      }
      case 'inspect':
        assert.equal(args[2], '{{.State.Status}}')
        return args.at(-1) === stoppedAfterRestart ? 'exited' : 'running'
      default:
        assert.fail(`Unexpected Docker command: ${args[0]}`)
    }
  }
  return {
    run,
    restarts,
    gatewayIsCurrent: () => gatewayAddress === authAddress,
  }
}

test('refreshes the gateway after Auth moves, with one restart of each container', () => {
  const fixture = dockerFixture()
  restartLocalAuthAndGateway(fixture.run)
  assert.deepEqual(fixture.restarts, [auth, gateway])
  assert.equal(fixture.gatewayIsCurrent(), true)
})

for (const [label, names] of [
  ['missing Auth', [gateway]],
  ['missing gateway', [auth]],
  ['duplicate Auth', [auth, auth, gateway]],
  ['duplicate gateway', [auth, gateway, gateway]],
  ['another project', [auth, 'supabase_kong_another-project']],
  ['unsafe suffix', ['supabase_auth_bad/name', 'supabase_kong_bad/name']],
]) {
  test(`rejects ${label} before any restart`, () => {
    const fixture = dockerFixture({ names })
    assert.throws(() => restartLocalAuthAndGateway(fixture.run), /same project/)
    assert.deepEqual(fixture.restarts, [])
  })
}

test('does not restart the gateway when Auth restart fails', () => {
  const fixture = dockerFixture({ failedRestart: auth })
  assert.throws(() => restartLocalAuthAndGateway(fixture.run), /restart failed/)
  assert.deepEqual(fixture.restarts, [auth])
})

test('does not restart the gateway when Auth exits after restart', () => {
  const fixture = dockerFixture({ stoppedAfterRestart: auth })
  assert.throws(() => restartLocalAuthAndGateway(fixture.run), /state: exited/)
  assert.deepEqual(fixture.restarts, [auth])
})

test('does not retry a failed gateway restart', () => {
  const fixture = dockerFixture({ failedRestart: gateway })
  assert.throws(() => restartLocalAuthAndGateway(fixture.run), /restart failed/)
  assert.deepEqual(fixture.restarts, [auth, gateway])
})

test('does not report success when the gateway exits after restart', () => {
  const fixture = dockerFixture({ stoppedAfterRestart: gateway })
  assert.throws(() => restartLocalAuthAndGateway(fixture.run), /state: exited/)
  assert.deepEqual(fixture.restarts, [auth, gateway])
})
