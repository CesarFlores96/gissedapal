$ErrorActionPreference = 'Stop'

$existing = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($existing) {
  Write-Output "FastAPI central ya esta activa en 8000 (PID $($existing.OwningProcess))."
  exit 0
}

$runner = Join-Path $PSScriptRoot 'run_local.ps1'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$process = Start-Process `
  -FilePath $powershell `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runner) `
  -WindowStyle Hidden `
  -PassThru

for ($attempt = 0; $attempt -lt 40; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      Write-Output "FastAPI central iniciada (launcher PID $($process.Id))."
      exit 0
    }
  } catch {
    # El servidor aun esta inicializando.
  }
}

if (-not $process.HasExited) {
  Stop-Process -Id $process.Id
}
throw 'FastAPI central no quedo disponible en http://127.0.0.1:8000.'
