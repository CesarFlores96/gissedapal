param(
  [Parameter(Mandatory)] [string]$Version,
  [string]$Notes = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$bundleDir = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
$releasesDir = Join-Path $repoRoot "backend\releases"
$versionDir = Join-Path $releasesDir $Version

$zip = Get-ChildItem -Path $bundleDir -Filter "*.nsis.zip" -ErrorAction Stop |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { throw "No se encontró ningún .nsis.zip en $bundleDir. Corré 'pnpm tauri build' primero." }
$sigPath = "$($zip.FullName).sig"
if (-not (Test-Path -LiteralPath $sigPath)) { throw "Falta la firma $sigPath. Verificá que TAURI_SIGNING_PRIVATE_KEY esté seteada al buildear." }

New-Item -ItemType Directory -Path $versionDir -Force | Out-Null
Copy-Item -LiteralPath $zip.FullName -Destination $versionDir -Force

$manifest = [ordered]@{
  version   = $Version
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content -LiteralPath $sigPath -Raw).Trim()
      file      = "$Version/$($zip.Name)"
    }
  }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $releasesDir "latest.json") -Encoding utf8

Write-Output "Release $Version publicado en $releasesDir. Reiniciá o recargá el backend si ya estaba corriendo."
