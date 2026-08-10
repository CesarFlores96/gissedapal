# Arquitectura SEDAPAL GIS

> Estado vigente desde 2026-08-10: el backend Python fue integrado en
> `D:\BD_LOCAL\api-fastapi`. La unica API escucha en `8000`; `8010`, PostgreSQL
> directo desde Tauri y Martin embebido estan retirados. El resto de esta nota
> describe la arquitectura historica y se conserva solo como referencia.

## Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                   SEDAPAL GIS Desktop App                    │
│                       (Tauri v2)                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              React UI Layer (19.2.8)                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │  │
│  │  │  MapContainer│  │  DistrictPanel│  │ Toolbar  │  │  │
│  │  └──────────────┘  └──────────────┘  └───────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ▲                                  │
│                           │ IPC Bridge                       │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Tauri Backend (Rust)                       │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │ Commands: fetch_districts, fetch_catastro   │   │  │
│  │  │ Events: mapBounds, featureSelected          │   │  │
│  │  │ Window & Plugin Management                  │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ▲                                  │
│                           │ HTTP/REST                        │
│                           ▼                                  │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ Network
                           ▼
        ┌──────────────────────────────────────┐
        │   FastAPI Backend (Python 3.12)      │
        │   Port: 8010 (desarrollo)            │
        │   Port: 8000 (producción)            │
        ├──────────────────────────────────────┤
        │  ┌─────────────────────────────────┐ │
        │  │ GIS Layer Service               │ │
        │  │ - Districts                     │ │
        │  │ - Catastral (Manzanas/Lotes)   │ │
        │  │ - Vector Tiles                  │ │
        │  └─────────────────────────────────┘ │
        │  ┌─────────────────────────────────┐ │
        │  │ Auth Service (JWT)              │ │
        │  │ - Token generation/validation   │ │
        │  │ - User permissions              │ │
        │  └─────────────────────────────────┘ │
        │  ┌─────────────────────────────────┐ │
        │  │ Data Import Service             │ │
        │  │ - GeoJSON parsing               │ │
        │  │ - Validation & transformation   │ │
        │  │ - Atomic transactions           │ │
        │  └─────────────────────────────────┘ │
        └──────────────────────────────────────┘
                           ▲
                           │ SQL
                           ▼
        ┌──────────────────────────────────────┐
        │  PostgreSQL + PostGIS                 │
        │  Connection Pool (psycopg-pool)       │
        ├──────────────────────────────────────┤
        │  Tables:                             │
        │  - districts (SRID:4326)             │
        │  - catastral_blocks (SRID:4326)     │
        │  - catastral_lots (SRID:4326)       │
        │  - users / permissions               │
        │  - audit_log                         │
        └──────────────────────────────────────┘
```

## Flujo de Datos Típico

### 1. Carga de Distritos

```
User opens app
    ↓
React useEffect → Tauri command
    ↓
Tauri invokes backend
    ↓
FastAPI GET /api/districts
    ↓
PostgreSQL SELECT * from districts
    ↓
PostGIS serializes geometry (GeoJSON)
    ↓
Return FeatureCollection to React
    ↓
MapLibre renders polygons
```

### 2. Importación de Datos Catastral

```
Admin triggers import
    ↓
Vite form submission (POST /api/catastro/import)
    ↓
FastAPI DataImporter class
    ├─ Download from SEDAPAL public service
    ├─ Parse GeoJSON/Shapefile
    ├─ Validate geometries (PostGIS ST_IsValid)
    ├─ Transform to SRID:4326
    └─ BEGIN TRANSACTION
        ├─ INSERT/UPDATE catastral_blocks
        ├─ INSERT/UPDATE catastral_lots
        ├─ Update spatial indices
        └─ COMMIT (or ROLLBACK on error)
    ↓
Return import summary to UI
```

## Capas de la Aplicación

### 1. Presentación (React + Tauri)

**Responsabilidades**:
- Renderizar UI components
- Gestionar estado local (mapState, selectedDistrict)
- Llamar a IPC commands del backend Tauri

**Tecnologías**:
- React 19 con hooks
- MapLibre GL (mapas)
- Tailwind CSS (estilos)
- TypeScript (type safety)

**Archivos principales**:
- `src/App.tsx` - Componente raíz
- `src/components/MapContainer.tsx` - Renderizado del mapa
- `src/types.ts` - Interfaces compartidas

### 2. Lógica de Negocio (Tauri + FastAPI)

**Tauri (src-tauri/src/)**:
- Commands que invocan APIs del backend
- Manejo de credenciales (keyring)
- Gestión de ventanas

**FastAPI (backend/app/)**:
- Lógica de validación
- Orquestación de datos
- Autenticación JWT
- Transacciones atómicas

**Archivos principales**:
- `app/main.py` - Punto de entrada
- `app/services/gis_layer.py` - Lógica GIS
- `app/services/catastral_importer.py` - Importación de datos
- `app/models.py` - Pydantic models
- `app/db.py` - Configuración de conexión

### 3. Persistencia (PostgreSQL + PostGIS)

**Responsabilidades**:
- Almacenamiento de geometrías
- Índices espaciales (GIST/BRIN)
- Transacciones ACID

**Extensiones activas**:
- PostGIS (funciones espaciales)
- uuid-ossp (generación de UUIDs)

**Tablas principales**:
- `districts` - Límites administrativos
- `catastral_blocks` (manzanas) - Zoom 13+
- `catastral_lots` (lotes) - Zoom 15+

## Patrones de Diseño

### 1. Service Layer (FastAPI)

Cada dominio tiene un servicio:

```python
class DistrictService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def get_all(self) -> List[District]:
        # Query + geometry serialization
        pass
    
    async def get_by_code(self, code: str) -> District:
        pass
```

**Beneficios**:
- Separación de concerns
- Fácil de testear
- Reutilizable

### 2. IPC Commands (Tauri)

```rust
#[tauri::command]
async fn fetch_districts(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<District>, String> {
    // Call FastAPI backend
    // Handle errors
    // Return to React
}
```

**Ventajas**:
- Type-safe Frontend-Backend
- Manejo centralizado de errores
- Logging automático

### 3. Hooks Personalizados (React)

```typescript
function useDistricts() {
    const [districts, setDistricts] = useState([]);
    const [loading, setLoading] = useState(false);
    
    useEffect(() => {
        invoke("fetch_districts").then(setDistricts);
    }, []);
    
    return { districts, loading };
}
```

**Ventajas**:
- Estado localizado
- Reutilizable
- Testing simplificado

## Flujos de Autenticación

### JWT Flow

```
1. User logs in (Supabase)
    ↓
2. Frontend stores JWT in secure storage (Tauri keyring)
    ↓
3. Each request includes JWT in Authorization header
    ↓
4. FastAPI validates JWT signature
    ↓
5. Extract user claims (sub, permissions)
    ↓
6. Verify resource access control
    ↓
7. Execute endpoint or return 403
```

### Role-Based Access Control

```python
@app.get("/api/catastro/import")
async def start_import(
    current_user: User = Depends(get_current_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403)
    # ... import logic
```

## Escalabilidad

### Optimizaciones Actuales

1. **Connection Pooling**: psycopg-pool (5-20 conexiones)
2. **Índices Espaciales**: GIST en geometrías
3. **Lazy Loading**: React lazy + code splitting Vite
4. **Caché**: MapLibre GL (tiles, styles)

### Mejoras Futuras

1. **Redis**: Caching de queries frecuentes
2. **Vector Tiles**: Generar .pbf desde PostGIS
3. **Clustering**: Agrupar lotes por zoom
4. **API Gateway**: Metricas, rate limiting, auth centralizada

## Monitoreo y Logging

### Frontend

- `localStorage` para debugging de estado
- Console logs (dev) → Log agregador (prod)

### Backend

```python
import logging

logger = logging.getLogger(__name__)
logger.info(f"Imported {count} catastral blocks")
logger.error("Database transaction failed", exc_info=True)
```

### Database

```sql
-- Auditoría de cambios
CREATE TABLE audit_log (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action VARCHAR(50),
    table_name VARCHAR(100),
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Configuración por Entorno

| Entorno | API URL | DB | WebView | Debug |
|---------|---------|----|---------| ------|
| Desarrollo | http://127.0.0.1:8010 | local/staging | Activo | ON |
| Producción | https://api.sedapal.lat | production | Sandbox | OFF |

---

**Última actualización**: 31 de julio, 2025
