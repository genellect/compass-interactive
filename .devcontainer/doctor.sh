#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
source .devcontainer/toolchain.env

failures=0

pass() {
  printf '[doctor] PASS %s\n' "$1"
}

fail() {
  printf '[doctor] FAIL %s\n' "$1" >&2
  failures=$((failures + 1))
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "$1 command"
  else
    fail "$1 command is missing"
  fi
}

for command_name in git node npm npx pnpm gh copilot docker; do
  require_command "$command_name"
done

if [[ "$(git rev-parse --is-inside-work-tree 2>/dev/null || true)" == "true" ]]; then
  pass "operable Git worktree"
else
  fail "workspace is not an operable Git worktree"
fi

actual_node="$(node -p 'process.versions.node')"
if [[ "$actual_node" == "$NODE_VERSION" && "$(tr -d '\r\n' < .node-version)" == "$NODE_VERSION" ]]; then
  pass "Node.js $actual_node"
else
  fail "Node.js $actual_node (expected $NODE_VERSION)"
fi

actual_pnpm="$(pnpm --version)"
if [[ "$actual_pnpm" == "$PNPM_VERSION" ]]; then
  pass "pnpm CLI $actual_pnpm"
else
  fail "pnpm CLI $actual_pnpm (expected $PNPM_VERSION)"
fi

if [[ -f package-lock.json && ! -f pnpm-lock.yaml ]]; then
  pass "canonical npm package-lock"
else
  fail "package manager boundary must remain npm with package-lock.json"
fi

docker_server=""
for _ in $(seq 1 30); do
  if docker_server="$(docker info --format '{{.ServerVersion}}' 2>/dev/null)"; then
    break
  fi
  sleep 1
done

if [[ "$docker_server" == "$DOCKER_VERSION"* ]]; then
  pass "isolated Docker daemon $docker_server"
else
  fail "Docker daemon ${docker_server:-unavailable} (expected $DOCKER_VERSION)"
fi

compose_version="$(docker compose version --short 2>/dev/null || true)"
if [[ "$compose_version" == "$DOCKER_COMPOSE_VERSION" ]]; then
  pass "Docker Compose $compose_version"
else
  fail "Docker Compose ${compose_version:-unavailable} (expected $DOCKER_COMPOSE_VERSION)"
fi

gh_version="$(gh --version | head -n 1 | awk '{print $3}')"
if [[ "$gh_version" == "$GITHUB_CLI_VERSION" ]]; then
  pass "GitHub CLI $gh_version"
else
  fail "GitHub CLI $gh_version (expected $GITHUB_CLI_VERSION)"
fi

copilot_version="$(copilot --version | head -n 1 | awk '{print $4}' | sed 's/\.$//')"
if [[ "$copilot_version" == "$COPILOT_CLI_VERSION" ]]; then
  pass "GitHub Copilot CLI $copilot_version"
else
  fail "GitHub Copilot CLI $copilot_version (expected $COPILOT_CLI_VERSION)"
fi

if [[ -x node_modules/.bin/playwright ]]; then
  pass "Playwright dependency"
else
  fail "Playwright dependency is missing; run npm ci"
fi

if [[ -x node_modules/.bin/supabase ]]; then
  pass "locked Supabase CLI"
else
  fail "Supabase CLI dependency is missing; run npm ci"
fi

if [[ -x node_modules/.bin/vite ]]; then
  pass "Vite dependency"
else
  fail "Vite dependency is missing; run npm ci"
fi

if [[ "$failures" -ne 0 ]]; then
  printf '[doctor] Environment is not ready: %d check(s) failed.\n' "$failures" >&2
  exit 1
fi

printf '[doctor] READY COMPASS Interactive Dev Container is reproducible and ready.\n'
