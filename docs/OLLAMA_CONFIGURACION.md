# Configuracion de Ollama para SEDAPAL GIS

La aplicacion toma la clave de Ollama desde la variable de entorno de usuario
`OLLAMA_API_KEY`. La clave no se incrusta en el `.exe`, en el instalador, en
Git ni en un release: cualquier secreto incluido en esos artefactos quedaria
expuesto y se compartiria con todas las maquinas.

## Configurar una maquina nueva

Desde PowerShell, en la carpeta del proyecto o junto al script distribuido:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-ollama-key.ps1
```

El script solicita la clave de forma protegida y la guarda para el usuario
actual de Windows. Luego hay que cerrar y volver a abrir SEDAPAL GIS.

En desarrollo, `iniciar-desarrollo.bat` vuelve a cargar automáticamente la
variable del usuario antes de iniciar Tauri. Esto evita que una consola vieja
arranque la aplicacion sin la clave.

Para eliminarla:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-ollama-key.ps1 -Clear
```

La aplicacion usa estos valores por defecto:

- `OLLAMA_HOST`: `https://ollama.com`
- `OLLAMA_MODEL`: `gemma4:31b-cloud`

Si una instalacion necesita otro endpoint o modelo, se pueden definir tambien
como variables de usuario antes de abrir la aplicacion. Nunca se deben escribir
claves reales en archivos de configuracion versionados ni pasarlas como
argumentos de comandos, porque pueden quedar en el historial de PowerShell.
