[CmdletBinding()]
param(
  [ValidateSet("config", "up", "shell", "check")]
  [string]$Action = "up"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cli = "@devcontainers/cli@0.88.0"

Push-Location $repoRoot
try {
  switch ($Action) {
    "config" {
      & npx.cmd -y $cli read-configuration --workspace-folder $repoRoot
    }
    "up" {
      & npx.cmd -y $cli up --workspace-folder $repoRoot --frozen-lockfile
    }
    "shell" {
      & npx.cmd -y $cli exec --workspace-folder $repoRoot bash
    }
    "check" {
      & npx.cmd -y $cli exec --workspace-folder $repoRoot bash -lc "npm run cloud:check"
    }
  }

  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  Pop-Location
}
