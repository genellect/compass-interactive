#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="@devcontainers/cli@0.88.0"
action="${1:-up}"

case "$action" in
  config)
    npx --yes "$cli" read-configuration --workspace-folder "$repo_root"
    ;;
  up)
    npx --yes "$cli" up --workspace-folder "$repo_root" --frozen-lockfile
    ;;
  shell)
    npx --yes "$cli" exec --workspace-folder "$repo_root" bash
    ;;
  check)
    npx --yes "$cli" exec --workspace-folder "$repo_root" bash -lc "npm run cloud:check"
    ;;
  *)
    echo "Usage: $0 {config|up|shell|check}" >&2
    exit 2
    ;;
esac
