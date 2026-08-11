[CmdletBinding()]
param(
  [string]$ApiUrl = "http://127.0.0.1:8000"
)

$ErrorActionPreference = "Stop"

$configDirectory = Join-Path $env:LOCALAPPDATA "SEDAPALGIS"
$configPath = Join-Path $configDirectory "api-url.txt"

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
[System.IO.File]::WriteAllText($configPath, "$($ApiUrl.Trim())`n")

Write-Output "Servicio GIS configurado en $configPath: $($ApiUrl.Trim())"
