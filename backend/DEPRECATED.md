# Backend GIS retirado

Este arbol se conserva solo como referencia historica de migracion. No debe iniciarse ni
desplegarse. Toda la API GIS, reportes, tiles MVT y updater vive en
`D:\BD_LOCAL\api-fastapi` y escucha en `127.0.0.1:8000`.

`backend\scripts\run_local.ps1` es un puente de compatibilidad que inicia el backend
central; nunca abre el puerto 8010.
