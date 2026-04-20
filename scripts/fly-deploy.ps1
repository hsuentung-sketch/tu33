# fly-deploy.ps1 — wraps `fly deploy` with GIT_COMMIT build arg so /api/version
# reports the real commit SHA (control plane uses this to detect outdated instances).
#
# Usage:
#   .\scripts\fly-deploy.ps1              # deploys HEAD
#   .\scripts\fly-deploy.ps1 -App foo     # targets a different app
#
# Requires: flyctl + git on PATH, run from repo root.

param(
  [string]$App
)

$ErrorActionPreference = 'Stop'

$commit = (git rev-parse HEAD).Trim()
if (-not $commit) { throw "git rev-parse HEAD returned empty" }

Write-Host "Deploying commit $commit..." -ForegroundColor Cyan

$args = @('deploy', '--build-arg', "GIT_COMMIT=$commit")
if ($App) { $args += @('-a', $App) }

& fly @args
