@echo off
setlocal
if not exist "D:\BD_LOCAL\api-fastapi\scripts\run_local.ps1" (
  echo Error: no existe el backend central D:\BD_LOCAL\api-fastapi.
  exit /b 1
)
echo [INFO] Verificando FastAPI central en http://127.0.0.1:8000
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\BD_LOCAL\api-fastapi\scripts\run_local.ps1"
endlocal
