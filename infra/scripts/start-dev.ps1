# infra/scripts/start-dev.ps1
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot/../..
node infra/scripts/check-env.mjs
npm run dev
Pop-Location
