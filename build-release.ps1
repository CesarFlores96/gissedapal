$ErrorActionPreference = "Stop"

$keyPath = "$env:USERPROFILE\.tauri\sedapalgis-updater.key"
$passwordPath = "$env:USERPROFILE\.tauri\sedapalgis-updater.key.password"

if (-not (Test-Path $keyPath)) {
    Write-Error "Clave privada no encontrada en $keyPath"
    exit 1
}

if (-not (Test-Path $passwordPath)) {
    Write-Error "Archivo de contraseña no encontrado en $passwordPath"
    exit 1
}

Write-Host "[INFO] Desencriptando contraseña..." -ForegroundColor Cyan
$encryptedPassword = Get-Content $passwordPath -Raw
$secureString = $encryptedPassword | ConvertTo-SecureString
$plainPassword = [System.Net.NetworkCredential]::new('', $secureString).Password

Write-Host "[INFO] Leyendo clave privada..." -ForegroundColor Cyan
$privateKey = Get-Content $keyPath -Raw

Write-Host "[INFO] Seteando variables de entorno..." -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY = $privateKey
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $plainPassword

& ".\scripts\configure-supabase-auth.ps1"
$supabaseConfigPath = Join-Path $env:LOCALAPPDATA "SEDAPALGIS\supabase-auth.json"
$supabaseConfig = Get-Content -Raw -LiteralPath $supabaseConfigPath | ConvertFrom-Json
$env:SEDAPALGIS_SUPABASE_URL = $supabaseConfig.url
$env:SEDAPALGIS_SUPABASE_PUBLISHABLE_KEY = $supabaseConfig.publishableKey

Write-Host "[INFO] Buildando .exe firmado (v0.1.1)..." -ForegroundColor Cyan
pnpm tauri build

if ($LASTEXITCODE -ne 0) {
    Write-Error "Build falló"
    exit 1
}

Write-Host "[INFO] Publicando release..." -ForegroundColor Green
& ".\scripts\publish-release.ps1" -Version "0.1.1" -Notes "Auto-updater + splashscreen"

Write-Host "[SUCCESS] Release publicado. El .exe está listo para instalar." -ForegroundColor Green
Write-Host "[NEXT] En otra terminal, corre: start-server.bat" -ForegroundColor Cyan
