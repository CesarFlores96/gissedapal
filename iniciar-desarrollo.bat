@echo off
setlocal EnableExtensions
set "PROJECT_ROOT=%~dp0"
set "VITE_PORT=1420"

cd /d "%PROJECT_ROOT%"

echo [1/3] Cerrando el visor GIS abierto...
taskkill /F /IM sedapalgis.exe >nul 2>&1

echo [2/3] Cerrando Vite anterior...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -State Listen -LocalPort %VITE_PORT% -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo [3/3] Cargando la configuracion local de Ollama...
for /f "usebackq delims=" %%K in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::GetEnvironmentVariable('OLLAMA_API_KEY','User')"`) do set "OLLAMA_API_KEY=%%K"
if defined OLLAMA_API_KEY (
  echo Ollama configurado para esta sesion.
) else (
  echo ADVERTENCIA: OLLAMA_API_KEY no esta configurada.
  echo Ejecuta: powershell -ExecutionPolicy Bypass -File scripts\configure-ollama-key.ps1
)
echo Iniciando SEDAPAL GIS contra el backend AWS configurado...
echo.
echo La consola permanecera abierta para mostrar errores de Vite, Tauri o Martin.
echo Cierra esta ventana o la aplicacion para terminar el modo desarrollo.
echo.
call pnpm tauri dev
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" goto :error
goto :end

:error
echo.
echo ERROR: el modo desarrollo termino con codigo %ERRORLEVEL%.
echo Revisa el mensaje anterior para identificar el problema.
pause
exit /b 1

:end
endlocal
exit /b 0
