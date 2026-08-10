param(
  [Parameter(Mandatory)] [securestring]$Password
)

$ErrorActionPreference = "Stop"

$dir = Join-Path $env:USERPROFILE ".tauri"
New-Item -ItemType Directory -Path $dir -Force | Out-Null

# ConvertFrom-SecureString cifra con DPAPI: sólo se puede leer con la misma
# cuenta de Windows en esta misma máquina, así que el archivo resultante no
# sirve si se copia a otra PC o lo abre otro usuario.
$Password | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $dir "sedapalgis-updater.key.password") -Encoding utf8

Write-Output "Contraseña guardada cifrada para $env:USERNAME en $env:COMPUTERNAME."
