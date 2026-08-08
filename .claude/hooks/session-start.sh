#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web.
#
# Prepares the non-live gate only: npm dependencies and the Playwright browsers
# used by the demo E2E projects. It deliberately does NOT start Supabase — that
# stack is heavy, needs a Docker daemon, and is only required for database, RLS,
# and Edge Function work. Use `bash .devcontainer/start-local-supabase.sh` for
# that, from the Dev Container.
#
# Contract: idempotent, non-interactive, fail-soft. Always exits 0. Every
# component that fails prints a WARN line naming the gate it blocks, so the
# agent knows what it cannot verify instead of discovering it mid-task.

set -uo pipefail

# Remote-only. A local Dev Container is provisioned by postCreateCommand and
# must not be re-provisioned here.
if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]]; then
  exit 0
fi

repo_root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$repo_root" || {
  printf '[session-start] WARN cannot enter repository root %s; no setup performed.\n' "$repo_root" >&2
  exit 0
}

stamp_dir="node_modules/.compass-session-start"

log() {
  printf '[session-start] %s\n' "$1"
}

warn() {
  printf '[session-start] WARN %s\n' "$1" >&2
}

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  fi
}

if ! command -v npm >/dev/null 2>&1; then
  warn 'npm is unavailable. Every gate (cloud:check, non-live suite, build, E2E) is unavailable.'
  exit 0
fi

# --- npm dependencies -------------------------------------------------------
# package-lock.json is canonical for this repository, so `npm ci` is used rather
# than `npm install`: it must never rewrite the lockfile.

lock_checksum="$(checksum package-lock.json)"
deps_stamp="$stamp_dir/npm-ci.stamp"
deps_ready=0

if [[ -n "$lock_checksum" && -f "$deps_stamp" && "$(cat "$deps_stamp" 2>/dev/null)" == "$lock_checksum" && -d node_modules/.bin ]]; then
  log 'npm dependencies already match package-lock.json; skipping npm ci.'
  deps_ready=1
else
  log 'Installing npm dependencies with npm ci.'
  if npm ci --no-audit --no-fund; then
    deps_ready=1
    mkdir -p "$stamp_dir" 2>/dev/null || true
    if [[ -n "$lock_checksum" ]]; then
      printf '%s\n' "$lock_checksum" >"$deps_stamp" 2>/dev/null || true
    fi
    log 'npm dependencies installed.'
  else
    warn 'npm ci failed. cloud:check, the non-live suite, the build, and every E2E gate are unavailable until dependencies install.'
  fi
fi

# --- Playwright browsers ----------------------------------------------------
# Only the demo/local E2E projects need these. A sandbox without egress to the
# Playwright CDN will fail here; that must be reported, never quietly ignored.

if [[ "$deps_ready" -ne 1 ]]; then
  warn 'Skipping Playwright browser install because npm dependencies are not ready. test:e2e:demo is unavailable.'
elif [[ ! -x node_modules/.bin/playwright ]]; then
  warn 'Playwright is not present in node_modules. test:e2e:demo is unavailable.'
else
  playwright_version="$(node -p "require('./node_modules/@playwright/test/package.json').version" 2>/dev/null || true)"
  browser_stamp="$stamp_dir/playwright-browsers.stamp"

  if [[ -n "$playwright_version" && -f "$browser_stamp" && "$(cat "$browser_stamp" 2>/dev/null)" == "$playwright_version" ]]; then
    log "Playwright browsers already installed for @playwright/test $playwright_version; skipping."
  else
    log 'Installing Playwright browsers (chromium, webkit).'
    if npx playwright install chromium webkit; then
      mkdir -p "$stamp_dir" 2>/dev/null || true
      if [[ -n "$playwright_version" ]]; then
        printf '%s\n' "$playwright_version" >"$browser_stamp" 2>/dev/null || true
      fi
      log 'Playwright browsers installed.'
    else
      warn 'Playwright browser install failed. test:e2e:demo and every other browser gate are NOT executable in this session; report them as not executed rather than as passing.'
    fi
  fi
fi

log 'Setup finished. Supabase was not started; run bash .devcontainer/start-local-supabase.sh from the Dev Container for database work.'
exit 0
