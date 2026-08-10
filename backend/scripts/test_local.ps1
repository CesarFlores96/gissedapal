$ErrorActionPreference = 'Stop'

function Import-DotEnv([string]$Path, [hashtable]$Aliases) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $name = $matches[1]
    $value = $matches[2].Trim().Trim('"').Trim("'")
    $target = if ($Aliases.ContainsKey($name)) { $Aliases[$name] } else { $name }
    if (-not [Environment]::GetEnvironmentVariable($target, 'Process')) {
      [Environment]::SetEnvironmentVariable($target, $value, 'Process')
    }
  }
}

Import-DotEnv 'D:\BD_LOCAL\api-fastapi\.env' @{
  SUPABASE_JWT_SECRET = 'AUTH_JWT_SECRET'
}
Import-DotEnv 'D:\Sedapal\apps\web\.env' @{
  NEXT_PUBLIC_SUPABASE_ANON_KEY = 'SUPABASE_ANON_KEY'
  NEXT_PUBLIC_SUPABASE_URL = 'SUPABASE_URL'
}

$backendRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $backendRoot
$env:RUN_GIS_INTEGRATION = '1'
& "$backendRoot\.venv\Scripts\python.exe" -m pytest -q
