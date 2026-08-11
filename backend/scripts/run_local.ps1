$ErrorActionPreference = 'Stop'

Write-Host '[SEDAPALGIS] Verificando FastAPI central en 8000.'
$runner = 'D:\BD_LOCAL\api-fastapi\scripts\run_local.ps1'
if (-not (Test-Path -LiteralPath $runner)) {
  throw 'No existe D:\BD_LOCAL\api-fastapi\scripts\run_local.ps1.'
}

& $runner -Port 8000
exit $LASTEXITCODE
