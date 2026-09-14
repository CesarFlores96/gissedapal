# Configuracion de Ollama para SEDAPAL GIS

**Vigente:** la app resuelve host/modelo/API key llamando a
`GET /api/v1/gis/ollama/config` en el backend (`sedapal-backend-aws`), que
comparte una sola clave central con el modulo de fotos de medidores y el
chatbot (`resolve_ollama_api_key` en `app/sedapalgis/repositories/fotos.py`).
Configurarla una vez desde la pantalla de fotos de medidores (o directamente
en el servidor) vale para **toda** la app, sin tocar el entorno de cada PC.

La variable de entorno de usuario `OLLAMA_API_KEY` que se describe mas abajo
sigue funcionando, pero ahora es solo un **fallback local**: se usa unicamente
si la llamada al backend falla (backend viejo sin esta ruta todavia, sin
sesion, sin red) o si ni la base de datos ni el propio entorno del servidor
tienen una clave configurada. Si ves `HTTP 401 Unauthorized` al analizar un
predio con Street View, lo primero a revisar es la clave configurada en el
servidor (fotos de medidores → configuracion de Ollama), no la de esta PC.

La clave no se incrusta en el `.exe`, en el instalador, en Git ni en un
release: cualquier secreto incluido en esos artefactos quedaria expuesto y se
compartiria con todas las maquinas.

## Fallback local (variable de entorno de usuario)

Solo hace falta configurar esto si el backend no puede resolver una clave
central (ver arriba) y necesitas que Street View/division de lotes sigan
funcionando igual con una clave propia de esta maquina.

### Configurar una maquina nueva

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
