#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fqx "$repo_root"; then
  git config --global --add safe.directory "$repo_root"
fi
git config --local fetch.prune true

mkdir -p node_modules "$HOME/.npm" "$HOME/.cache"
for cache_path in node_modules "$HOME/.npm" "$HOME/.cache"; do
  if [[ ! -w "$cache_path" ]]; then
    sudo chown -R "$(id -u):$(id -g)" "$cache_path"
  fi
done
npm ci
npx playwright install --with-deps chromium webkit
