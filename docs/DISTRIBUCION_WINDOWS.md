# Operación de distribución Windows

## Alcance

La distribución soportada es Windows 10/11 x64 mediante el instalador NSIS de
Tauri. No se publican MSI, macOS ni Linux en esta fase.

El ejecutable usa por defecto `https://sedapalweb.com/fastapi/`. Para desarrollo
y soporte conserva la precedencia `SEDAPALGIS_API_URL` →
`%LOCALAPPDATA%\SEDAPALGIS\api-url.txt` → URL productiva. Solo el valor exacto
del dominio productivo anterior se migra automáticamente; localhost, LAN y
destinos personalizados se preservan.

## Prepublicación

- El repositorio `CesarFlores96/gissedapal` debe ser público y GitHub Releases
  debe estar habilitado.
- Guardar `TAURI_SIGNING_PRIVATE_KEY` y
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` como secretos del repositorio. Deben
  corresponder al `plugins.updater.pubkey` de `src-tauri/tauri.conf.json`.
- Confirmar que el certificado de `sedapalweb.com` es válido desde una red
  externa, presenta la cadena completa y no es interceptado por el proxy/WAF.
- Confirmar que un `GET` o `POST` de autenticación autorizado llega al FastAPI
  central y que tiles y GIS están disponibles para una cuenta de prueba.

## Publicación

El tag `vX.Y.Z` activa `.github/workflows/release.yml`. El workflow rechaza un
tag cuya versión no coincida con `src-tauri/tauri.conf.json`, compila en Windows
y publica los artefactos NSIS firmados junto con `latest.json`.

No uses los scripts históricos que copiaban archivos a `backend/releases`; el
canal de actualización es GitHub Releases.

## Validación de entrega

En una VM limpia de Windows 10/11 x64:

1. Descargar el instalador desde el Release público y completar la instalación.
2. Iniciar la aplicación sin herramientas de desarrollo ni servicios locales.
3. Autenticarse con una cuenta de prueba y comprobar mapa, búsqueda, reportes,
   tiles y Google Maps.
4. Publicar un tag posterior y comprobar detección, descarga, instalación y
   reinicio automático.
5. Desconectar la red para confirmar que la app informa el fallo de conexión;
   desinstalar y comprobar que no quedaron servicios instalados.

Windows/SmartScreen puede advertir sobre el editor mientras no se incorpore un
certificado de firma de código. Esa advertencia es independiente de la firma
criptográfica de actualización de Tauri.
