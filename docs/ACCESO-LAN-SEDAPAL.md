# Acceso LAN Sedapal para SEDAPAL GIS

Esta guía permite que el instalador Tauri se conecte desde otros equipos de la
red Sedapal al FastAPI que usa la base de datos local. La aplicación nunca se
conecta directamente a PostgreSQL.

```text
Equipo remoto con SEDAPAL GIS
        -> FastAPI: 1.8.1.116:8000
        -> Base de datos local
```

## Preparar el equipo servidor

En el equipo que tiene `D:\BD_LOCAL`, ejecute una vez como administrador:

```powershell
New-NetFirewallRule -DisplayName "SEDAPALGIS API LAN 8000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Domain -RemoteAddress 1.8.0.0/16
```

Después de cada reinicio del servidor, inicie la API mediante:

```text
D:\BD_LOCAL\iniciar_servidor.bat
```

El archivo inicia FastAPI en `0.0.0.0:8000`; por ello puede recibir conexiones
de la red interna. Mantenga su ventana abierta mientras los equipos remotos
usen GIS.

No abra el puerto de PostgreSQL ni cree reglas de firewall fuera del perfil de
dominio.

## Preparar cada equipo con GIS

1. Instale el instalador de SEDAPAL GIS.
2. Cierre GIS si estaba abierto.
3. Abra PowerShell y ejecute una sola vez:

```powershell
$api = 'http' + '://' + '1.8.1.116' + ':8000'
$dir = "$env:LOCALAPPDATA\SEDAPALGIS"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
[IO.File]::WriteAllText("$dir\api-url.txt", $api)
```

Esto guarda una configuración por usuario en
`%LOCALAPPDATA%\SEDAPALGIS\api-url.txt`. El cliente Tauri la lee al iniciar;
si no existe, usa el túnel HTTPS de producción.

La aplicación permite HTTP remoto solamente para direcciones de la red
`1.8.0.0/16`. No use esta configuración con redes públicas.

## Validar

En el equipo remoto, antes de abrir GIS:

```powershell
$api = 'http' + '://' + '1.8.1.116' + ':8000'
Invoke-WebRequest ($api + '/health')
```

Debe responder `StatusCode : 200`. Luego abra GIS, inicie sesión y compruebe
mapa, búsqueda de suministro y reportes.

En la consola del servidor deben aparecer solicitudes desde la dirección IP del
equipo remoto. Si no aparece ninguna, revise el archivo `api-url.txt`, el
firewall de dominio y que `D:\BD_LOCAL\iniciar_servidor.bat` siga abierto.

## Operación y siguiente mejora

La creación de `api-url.txt` se hace una sola vez por usuario/equipo. Para
muchos equipos, el área de TI puede distribuir ese archivo con una política de
dominio (GPO) en vez de ejecutarlo manualmente.

Para usar un nombre de dominio interno en lugar de la IP, implemente HTTPS con
un certificado confiable de la CA corporativa y actualice el cliente. No se
debe cambiar a HTTP con un nombre de dominio sin ese control.
