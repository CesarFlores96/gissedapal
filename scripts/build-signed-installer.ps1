[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$keyPath = Join-Path $env:USERPROFILE ".tauri\sedapalgis-updater.key"
$passwordFile = Join-Path $env:USERPROFILE ".tauri\sedapalgis-updater.key.password"

if (-not (Test-Path -LiteralPath $keyPath)) {
  throw "No se encontró la clave privada de actualización en $keyPath."
}
if (-not (Test-Path -LiteralPath $passwordFile)) {
  throw "No hay contraseña guardada. Ejecuta scripts\save-signing-password.ps1 primero."
}

$secure = Get-Content -LiteralPath $passwordFile | ConvertTo-SecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

Push-Location $repoRoot
try {
  $env:TAURI_SIGNING_PRIVATE_KEY = $keyPath
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

  pnpm tauri build
  if ($LASTEXITCODE -ne 0) { throw "pnpm tauri build falló (código $LASTEXITCODE)." }

  $config = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "src-tauri\tauri.conf.json") | ConvertFrom-Json
  $bundleDirectory = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
  $installer = Get-ChildItem -LiteralPath $bundleDirectory -Filter "*-setup.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $installer) { throw "No se generó el instalador NSIS." }
  if (-not (Test-Path -LiteralPath "$($installer.FullName).sig")) { throw "Falta la firma del instalador." }

  Write-Output "Instalador firmado generado: $($installer.FullName)"
  Write-Output "Para publicar, crea y sube el tag v$($config.version). GitHub Actions creará el Release y latest.json."
}
finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Pop-Location
}
