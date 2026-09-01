# SEDAPAL GIS

Aplicación de escritorio para Windows 10/11 x64 que consulta el servicio GIS
central de SEDAPAL. La instalación de usuario no incluye ni requiere Python,
Node.js, Rust, FastAPI ni una base de datos local.

## Instalar en otro equipo

1. Descarga `SEDAPAL GIS_<versión>_x64-setup.exe` desde la última publicación
   de [GitHub Releases](https://github.com/CesarFlores96/gissedapal/releases).
2. Ejecuta el instalador y acepta la instalación de Microsoft Edge WebView2 si
   el equipo aún no lo tiene.
3. Abre **SEDAPAL GIS** desde el menú Inicio e inicia sesión con una cuenta
   autorizada.

El equipo debe tener acceso a Internet y a `https://sedapalweb.com/fastapi/`. La
aplicación guarda el token de sesión en el almacén de credenciales de Windows.

> La primera versión se distribuye sin certificado de firma de código de
> Windows. SmartScreen puede mostrar una advertencia de editor desconocido;
> descarga el instalador únicamente desde el Release oficial enlazado arriba.

## Actualizaciones

Al iniciar, la aplicación consulta el `latest.json` del último GitHub Release.
Cuando existe una versión superior, muestra el aviso para descargarla,
instalarla y reiniciar. Las actualizaciones están firmadas con la clave pública
incluida en la aplicación.

## Publicar una versión

1. Actualiza el mismo número SemVer en `package.json`,
   `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`.
2. Confirma y sube los cambios a `main`.
3. Crea y sube el tag correspondiente, por ejemplo `v1.0.2`.

```powershell
git tag v1.0.2
git push origin main
git push origin v1.0.2
```

El workflow de GitHub compila sólo el instalador NSIS x64, genera sus firmas y
publica el Release con `latest.json`. Antes del primer tag, configura en GitHub
Actions los secretos `TAURI_SIGNING_PRIVATE_KEY` y
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. La clave privada nunca debe subirse al
repositorio.

Para comprobar un instalador firmado localmente, ejecuta:

```powershell
.\scripts\build-signed-installer.ps1
```

## Desarrollo

El backend contenido en este checkout es histórico y no participa en la
distribución. El desarrollo del escritorio se realiza con las herramientas
habituales de Node, Rust y Tauri; valida Rust desde `src-tauri`.

```powershell
pnpm install
pnpm typecheck
pnpm test
cargo test --manifest-path src-tauri\Cargo.toml
pnpm tauri build
```

## Soporte

Si la app no inicia, reinstala desde el último Release. Si no puede iniciar
sesión o cargar datos, verifica la conectividad HTTPS a `sedapalweb.com`. El
equipo que opera ese dominio debe mantener un certificado TLS público y vigente
con cadena de confianza completa; no se debe instalar ningún certificado ni
servicio local en los equipos usuarios.
