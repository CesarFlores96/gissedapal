# Importación de red de agua

Los XLS de `lineas_agua_*.xls` y `tuberias_conexion_*.xls` son exportaciones
HTML con extensión `.xls`. No se carga una geometría inventada: el importador
usa `GLOBALID` para recuperar la geometría oficial de ArcGIS `movilAP`.

## Preparación

Aplicar la migración contra la base PostGIS configurada en `DATABASE_URL`:

```powershell
python backend/scripts/run_migration.py backend/migrations/015_water_network_xls.up.sql
```

## Carga

Tuberías primarias/secundarias:

```powershell
python backend/scripts/import_water_network_xls.py `
  C:\Users\practicanteesce7\Downloads\lineas_agua_010.xls `
  C:\Users\practicanteesce7\Downloads\lineas_agua_011.xls
```

Acometidas domiciliarias:

```powershell
python backend/scripts/import_water_connections_xls.py `
  C:\Users\practicanteesce7\Downloads\tuberias_conexion_001.xls `
  C:\Users\practicanteesce7\Downloads\tuberias_conexion_010.xls `
  C:\Users\practicanteesce7\Downloads\tuberias_conexion_011.xls
```

Antes de confirmar una carga, agregar `--dry-run`. La operación es idempotente
por `source_system + source_globalid` y transforma EPSG:32718 a EPSG:4326.

La aplicación muestra `Tuberías de agua` y `Conexiones domiciliarias` como
capas independientes.
