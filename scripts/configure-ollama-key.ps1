[CmdletBinding()]
param(
  [switch]$Clear
)

$ErrorActionPreference = "Stop"

if ($Clear) {
  [Environment]::SetEnvironmentVariable("OLLAMA_API_KEY", $null, "User")
  Write-Output "OLLAMA_API_KEY fue eliminada de las variables del usuario."
  Write-Output "Cierra y vuelve a abrir SEDAPAL GIS para que tome el cambio."
  exit 0
}

Write-Output "La clave se guardara solo en las variables del usuario de Windows."
Write-Output "No se incorpora al ejecutable, al instalador ni al repositorio."
$secure = Read-Host "OLLAMA_API_KEY" -AsSecureString
$bstr = [IntPtr]::Zero
$plain = $null

try {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain)) {
    throw "La clave no puede estar vacia."
  }

  [Environment]::SetEnvironmentVariable("OLLAMA_API_KEY", $plain, "User")
  Write-Output "OLLAMA_API_KEY quedo configurada para este usuario de Windows."
  Write-Output "Cierra y vuelve a abrir SEDAPAL GIS antes de analizar una captura."
}
finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  $plain = $null
}
