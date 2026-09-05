import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runSupabaseCommand } from './run-supabase-command.mjs'

// These tests use docker exec against the explicitly local Supabase container.
// They never accept a database URL, access token or hosted project reference.
const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'

export function runSupabase(args) {
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('Run this local database test through npm.')
  runSupabaseCommand({ npmCli, args })
}

export function runSql(sql, readyMarker) {
  let resolveReady
  let rejectReady
  let readySettled = !readyMarker
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
    if (!readyMarker) resolve()
  })
  const done = new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', 'postgres',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const observe = () => {
      if (!readySettled && (stdout + stderr).includes(readyMarker)) {
        readySettled = true
        resolveReady()
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk; observe() })
    child.stderr.on('data', chunk => { stderr += chunk; observe() })
    child.on('error', error => {
      if (!readySettled) { readySettled = true; rejectReady(error) }
      reject(error)
    })
    child.on('exit', code => {
      if (code !== 0 || !readySettled) {
        const error = new Error(stderr.trim() || stdout.trim() || `psql exited ${code}`)
        if (!readySettled) { readySettled = true; rejectReady(error) }
        reject(error)
      } else resolve(stdout)
    })
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') reject(error)
    })
    child.stdin.end(sql)
  })
  // Callers observe done after the barrier is ready; prevent an unhandled
  // rejection if a startup failure rejects both promises first.
  if (readyMarker) void done.catch(() => {})
  return readyMarker ? { ready, done } : done
}

export const fixtureSql = readFileSync(
  new URL('../fixtures/presenter-authority-fixture.sql', import.meta.url), 'utf8',
)

export const pageSql = `select public.apply_presenter_page_v1(
  '00000000-0000-4000-8000-00000000e513'::uuid,
  repeat('f',64), repeat('c',64), 1, gen_random_uuid(),
  repeat('d',64), repeat('e',64), 102, 2, 2)`

export const heartbeatSql = `select public.heartbeat_presenter_connection_v1(
  '00000000-0000-4000-8000-00000000e513'::uuid,
  repeat('f',64), repeat('c',64), repeat('d',64), repeat('e',64))`

export const manualSql = `select public.manage_google_admin_display_state_v1(
  repeat('1',64), '00000000-0000-4000-8000-00000000e502'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'https://accounts.google.com', repeat('a',64), 1, true,
  'goToPage', gen_random_uuid(),
  '00000000-0000-4000-8000-00000000e509'::uuid, 3, null, null)`

export const staleSql = `update public.presenter_connections
  set last_seen_at = statement_timestamp() - interval '46 seconds'
  where id = '00000000-0000-4000-8000-00000000e513'::uuid`

export function assertState(page, reason) {
  return `do $$ begin
    if not exists (
      select 1 from public.presenter_connections as connection
      join public.lecture_live_state as live
        on live.lecture_session_id = connection.lecture_session_id
      where connection.id = '00000000-0000-4000-8000-00000000e513'::uuid
        and connection.state = 'revoked' and connection.revoked_at is not null
        and connection.revoke_reason = '${reason}'
        and live.current_pdf_page = ${page}
    ) then raise exception 'Presenter did not converge to ${reason}, page ${page}';
    end if;
  end; $$;`
}

export const assertCleanSql = `do $$ begin
  if exists (select 1 from public.presenter_connections)
    or exists (select 1 from public.admin_sessions)
    or exists (select 1 from private.admin_environments)
    or exists (select 1 from auth.users)
    or (select enabled from private.presenter_runtime_gate where singleton)
  then raise exception 'Presenter authority test requires a clean local reset database';
  end if;
end; $$;`
