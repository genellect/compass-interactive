#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

bash .devcontainer/install-dependencies.sh
npm run cloud:doctor

printf '%s\n' \
  'Codex Cloud source/test setup is ready.' \
  'Before disconnecting the local PC, push a dedicated branch and run: npm run cloud:handoff' \
  'Hosted, paid, Human and Production actions remain separately approved.'
