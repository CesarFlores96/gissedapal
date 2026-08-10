[CmdletBinding()]
param(
  [string]$EnvironmentFile = "D:\Sedapal\apps\web\.env"
)

$ErrorActionPreference = "Stop"

function Read-EnvironmentValue {
  param(
    [string[]]$Names,
    [string[]]$Lines
  )

  foreach ($name in $Names) {
    $processValue = [Environment]::GetEnvironmentVariable($name, "Process")
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
      return $processValue.Trim()
    }

    $prefix = "$name="
    $line = $Lines | Where-Object { $_.TrimStart().StartsWith($prefix) } | Select-Object -Last 1
    if ($line) {
      return $line.Substring($line.IndexOf("=") + 1).Trim().Trim('"').Trim("'")
    }
  }

  return $null
}

$lines = if (Test-Path -LiteralPath $EnvironmentFile) {
  Get-Content -LiteralPath $EnvironmentFile
} else {
  @()
}

$url = Read-EnvironmentValue -Names @(
  "SEDAPALGIS_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL"
) -Lines $lines
$publishableKey = Read-EnvironmentValue -Names @(
  "SEDAPALGIS_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
) -Lines $lines

if ([string]::IsNullOrWhiteSpace($url) -or [string]::IsNullOrWhiteSpace($publishableKey)) {
  throw "No se encontraron la URL y la clave publica de Supabase Auth."
}

$configDirectory = Join-Path $env:LOCALAPPDATA "SEDAPALGIS"
$configPath = Join-Path $configDirectory "supabase-auth.json"
$config = [ordered]@{
  url = $url
  publishableKey = $publishableKey
} | ConvertTo-Json

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
[System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))
Write-Output "Supabase Auth configurado para SEDAPALGIS en $configPath"
