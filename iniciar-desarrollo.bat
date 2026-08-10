@echo off
setlocal EnableExtensions
set "PROJECT_ROOT=%~dp0"
set "VITE_PORT=1420"
set "API_PORT=8000"

if /I not "%~1"=="__hidden" (
  powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%ComSpec%' -ArgumentList '/c ""%~f0" __hidden"' -WindowStyle Hidden"
  exit /B 0
)

echo [1/3] Cerrando el visor GIS abierto...
taskkill /F /IM sedapalgis.exe >nul 2>&1

echo [2/3] Cerrando Vite activo y comprobando FastAPI central...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -State Listen -LocalPort %VITE_PORT% -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; if (-not (Get-NetTCPConnection -State Listen -LocalPort %API_PORT% -ErrorAction SilentlyContinue)) { Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','D:\BD_LOCAL\api-fastapi\scripts\run_local.ps1' -WorkingDirectory 'D:\BD_LOCAL\api-fastapi' -WindowStyle Hidden }"

echo [3/3] Iniciando Vite y aplicacion Tauri contra FastAPI 8000...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\configure-supabase-auth.ps1"
if errorlevel 1 exit /B 1
start "" /B powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%PROJECT_ROOT%'; pnpm tauri dev"

endlocal
