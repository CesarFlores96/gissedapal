param(
  [Parameter(Mandatory)] [string]$Version,
  [string]$Notes = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$keyPath = Join-Path $env:USERPROFILE ".tauri\sedapalgis-updater.key"
$passwordFile = Join-Path $env:USERPROFILE ".tauri\sedapalgis-updater.key.password"

if (-not (Test-Path -LiteralPath $passwordFile)) {
  throw "No hay contraseña guardada. Corré primero:`n  scripts\save-signing-password.ps1 -Password (Read-Host -AsSecureString)"
}

$secure = Get-Content -LiteralPath $passwordFile | ConvertTo-SecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

Push-Location $repoRoot
try {
  $env:TAURI_SIGNING_PRIVATE_KEY = $keyPath
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

  pnpm tauri build
  if ($LASTEXITCODE -ne 0) { throw "pnpm tauri build falló (código $LASTEXITCODE)." }
}
finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Pop-Location
}

& (Join-Path $PSScriptRoot "publish-release.ps1") -Version $Version -Notes $Notes
