$ErrorActionPreference = "Stop"

cd D:\SEDAPALGIS

Write-Host "=== PASO 1: Build Tauri ===" -ForegroundColor Cyan
$keyPath = "$env:USERPROFILE\.tauri\sedapalgis-updater.key"
if (-not (Test-Path $keyPath)) {
    Write-Error "Clave privada no encontrada en $keyPath"
    exit 1
}

$privateKey = Get-Content $keyPath -Raw

Write-Host "Ingresa contraseña de la clave privada:" -ForegroundColor Yellow
$securePassword = Read-Host -AsSecureString
$plainPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password

$env:TAURI_SIGNING_PRIVATE_KEY = $privateKey
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $plainPassword

& ".\scripts\configure-supabase-auth.ps1"
$supabaseConfigPath = Join-Path $env:LOCALAPPDATA "SEDAPALGIS\supabase-auth.json"
$supabaseConfig = Get-Content -Raw -LiteralPath $supabaseConfigPath | ConvertFrom-Json
$env:SEDAPALGIS_SUPABASE_URL = $supabaseConfig.url
$env:SEDAPALGIS_SUPABASE_PUBLISHABLE_KEY = $supabaseConfig.publishableKey

Write-Host "Buildando v0.1.1..." -ForegroundColor Cyan
pnpm tauri build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build falló"
    exit 1
}

Write-Host ""
Write-Host "=== PASO 2: Publicar Release ===" -ForegroundColor Cyan
& ".\scripts\publish-release.ps1" -Version "0.1.1" -Notes "Auto-updater + splashscreen + túnel HTTPS"

Write-Host ""
Write-Host "=== LISTO ===" -ForegroundColor Green
Write-Host "1. cd D:\SEDAPALGIS && .\start-server.bat     (en una terminal)"
Write-Host "2. cloudflared tunnel run sedapal-ota        (en otra terminal)"
Write-Host "3. Instala el .exe desde src-tauri/target/release/bundle/nsis/"
Write-Host "4. La app detectará v0.1.1 y se actualizará automáticamente"
