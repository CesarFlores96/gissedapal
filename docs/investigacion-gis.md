# Investigación GIS y contratos implementados

Fecha de verificación: 2026-07-22.

## Fuentes inspeccionadas

- Vault operativo: `D:\head-sedapal`.
- Backend activo: `D:\BD_LOCAL\api-fastapi`.
- Snapshot de esquema: `D:\Sedapal\supabase\schema.sql`.
- Base PostgreSQL local `bd_facturacion_local`, consultada en modo lectura durante el diagnóstico.

## Inventario real

- PostGIS 3.6.2 está activo.
- `customer_supplies`: 17,759 filas; 16,456 tienen latitud y longitud.
- `meter_registry`: 91,941 filas; 15,993 suministros distintos enlazables por `nis_rad`.
- `network_pipes`, `network_nodes`, `hydraulic_sectors`, `operational_zones` y `meters`: sin filas al verificar.
- `network_pipes.geom` es `LineString,4326`; admite `agua_potable`, `alcantarillado` y `agua_residual_tratada`.
- No existían entidades poligonales para cuadrantes o lotes.
- Se reutiliza el GeoJSON local de 50 distritos Lima/Callao, cuya propiedad `institucion` identifica a IGN.

## Endpoints activos encontrados

- `/api/gis/operational`: suministros paginados y tuberías opcionales.
- `/api/gis/anomalies`: anomalías georreferenciadas.
- `/api/network/pipes`: consulta y creación de tuberías.
- `/api/meters/by-supply-code/{supply_code}`: detalle de medidor.
- `/api/customer-supplies/search`: búsqueda por NIS.

Ninguno entregaba en un único contrato BBOX distritos, cuadrantes, lotes, redes, suministros y medidores, ni resolvía la jerarquía espacial completa.

## Contratos de esta aplicación

- `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`.
- `GET /api/v1/gis/capas` con BBOX WGS84, selección de capas y paginación.
- `GET /api/v1/gis/suministro/{nis}` para ficha técnica y último medidor.
- `GET /api/v1/gis/relacion` para resolución espacial por coordenada.

Las capas sin geometrías oficiales devuelven una `FeatureCollection` vacía con `available=false`. `sector` y `lot_code` se presentan como referencias textuales provisionales; nunca se convierten en polígonos inventados.

`/api/v1/gis/capas` acepta además `district=<nombre>` para limitar espacialmente suministros y medidores. La capa `distritos` incluye `supply_count`, calculado con PostGIS, que alimenta la extrusión temática 3D. La altura representa cantidad de suministros y no elevación ni altura real de edificios.

El usuario operativo de PostgreSQL no es propietario de `customer_supplies`. Por ello, las coordenadas se indexan en `gis_supply_locations`, una proyección espacial propia que FastAPI reconcilia al iniciar y cada 60 segundos, sin alterar la tabla operativa original ni requerir privilegios de superusuario.

## Acceso mediante el túnel existente

El cliente de producción usa `https://api.sedapal.lat`. El túnel continúa terminando en el FastAPI principal de `127.0.0.1:8000`, que reenvía exclusivamente `/api/v1/auth/*` y `/api/v1/gis/*` al servicio GIS de `127.0.0.1:8010`. PostgreSQL permanece accesible solo por loopback y todos los cálculos PostGIS se ejecutan en `bd_facturacion_local`; no existe réplica GIS en Supabase.

La ruta local y los controles JWT fueron validados. Desde la red corporativa de este equipo, FortiGuard responde `403 Access Blocked` para el dominio público, por lo que la validación exterior queda condicionada a que esa política permita `api.sedapal.lat`.

El ejecutable resuelve la URL en este orden: `SEDAPALGIS_API_URL`, `%LOCALAPPDATA%\SEDAPALGIS\api-url.txt` y finalmente el túnel `https://api.sedapal.lat`. El servidor local usa el archivo persistente con `http://127.0.0.1:8010`; las instalaciones de otros equipos mantienen el túnel al no tener ese archivo. La URL se valida y HTTP solo se admite para `localhost` o direcciones loopback.

## Jerarquía catastral estructurada (2026-08-04)

`GET /api/v1/gis/suministro/{nis}` expone `cadastre` con distrito, manzana (`COD_MZA`), lote lógico (`CUPCODE`), estado de geometría y vinculación al catálogo CUA. La relación principal se obtiene desde `gis_supply_lot_links`; el cruce espacial queda como respaldo para registros sin enlace estructurado.

Un CUPCODE solo enfoca automáticamente un polígono cuando tiene una geometría única o cuando la coordenada del suministro cae dentro de una de sus geometrías. Si existen varios candidatos no se elige uno de forma arbitraria. La respuesta identifica el método mediante `cadastralLink.method` (`CUPCODE` o `SPATIAL`).

El inspector muestra esta jerarquía como datos separados y navegables. Las importaciones usan el NIS como clave única: actualizan el suministro existente y solo insertan los que todavía no existen.
