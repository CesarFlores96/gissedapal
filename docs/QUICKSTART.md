# Guía Rápida: Comenzar con SEDAPAL GIS

## 5 Minutos para desarrollar

### 1️⃣ Clona y configura (3 min)

```powershell
# Clona el repo (ya hecho)
cd D:\SEDAPALGIS

# Instala dependencias
pnpm install

# Configura Python
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
```

### 2️⃣ Configura la BD (requiere acceso previo)

```powershell
# Obtén DATABASE_URL de tu administrador
$env:DATABASE_URL = "postgresql://user:pass@host/db"

# O crea archivo local
mkdir %LOCALAPPDATA%\SEDAPALGIS
echo "http://127.0.0.1:8010" > %LOCALAPPDATA%\SEDAPALGIS\api-url.txt
```

### 3️⃣ Inicia servicios

**Terminal 1 - Backend FastAPI:**
```powershell
cd D:\SEDAPALGIS\backend
backend\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8010
```

**Terminal 2 - Frontend Tauri:**
```powershell
cd D:\SEDAPALGIS
pnpm tauri dev
```

**Resultado**: Aplicación Tauri se abre en localhost, conectada a API en 8010 ✅

---

## Estructura de Directorios Clave

```
D:\SEDAPALGIS
├── src/                ← Frontend React
├── backend/            ← API FastAPI
├── src-tauri/          ← Desktop app (Rust)
├── data/               ← GeoJSON y shapefiles
├── docs/               ← Documentación
│   ├── ARCHITECTURE.md ← Arquitectura detallada
│   └── GRAPHIFYY_GUIDE.md ← Análisis de código
└── CLAUDE.md           ← Guía completa del proyecto
```

---

## Primeros Pasos

### A. Ver el mapa en acción

1. Abre la app (desde terminal 2)
2. Debe mostrar Lima/Callao
3. Zoom in/out con rueda del ratón
4. Click en distritos para ver detalles

### B. Hacer un cambio en React

```typescript
// Editar: src/components/MapContainer.tsx
// Cambiar zoom inicial
const mapContainer = useRef(null);
const map = useRef(null);

// Antes:
const [zoom, setZoom] = useState(10);
// Después:
const [zoom, setZoom] = useState(12); // Zoom más cercano

// Guarda: El frontend auto-reload (Vite dev server)
```

### C. Hacer un cambio en FastAPI

```python
# Editar: backend/app/routers/districts.py
@router.get("/api/districts")
async def list_districts():
    # Cambiar algo aquí
    return {...}

# Guarda: uvicorn auto-reload (--reload flag)
```

---

## Comandos Útiles

### Testing

```powershell
# Frontend
pnpm test              # Vitest
pnpm lint              # ESLint
pnpm typecheck         # TypeScript

# Backend
cd backend
backend\.venv\Scripts\python.exe -m pytest tests -v

# Rust/Tauri
cargo test --manifest-path src-tauri\Cargo.toml
```

### Build

```powershell
# Build para desarrollo
pnpm build

# Build para distribución
pnpm tauri build
# → Genera instalador en src-tauri/target/release/
```

### Análisis de código (graphifyy)

```powershell
# Generar gráfico de dependencias
cd backend
python -m graphifyy app --output ../docs/graphs/dependencies.png --format png

# Ver en navegador
start ../docs/graphs/dependencies.png
```

---

## Debugging

### Backend no responde

```powershell
# 1. Verifica que esté corriendo
curl http://127.0.0.1:8010/health

# 2. Revisa logs en terminal
# 3. Comprueba DATABASE_URL
echo $env:DATABASE_URL

# 4. Reinicia
Ctrl+C en la terminal de backend
```

### Frontend no carga datos

```typescript
// Abre DevTools (F12)
// Tab: Console
// Busca errores de CORS o fetch
// Luego Network tab para ver requests
```

### Mapa no carga

- Verifica MapLibre GL en src/components/MapContainer.tsx
- Comprueba que FastAPI devuelve GeoJSON válido
- Usa: `curl http://127.0.0.1:8010/api/districts`

---

## Documentación Completa

| Documento | Para |
|-----------|------|
| [CLAUDE.md](../CLAUDE.md) | Overview completo del proyecto |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Diagramas y patrones técnicos |
| [GRAPHIFYY_GUIDE.md](./GRAPHIFYY_GUIDE.md) | Análisis de código con graphifyy |
| [README.md](../README.md) | Setup inicial (migraciones, etc) |

---

## Checklist para Desarrolladores Nuevos

- [ ] Clonaste el repo
- [ ] Instalaste Node.js 22 + pnpm 9
- [ ] Instalaste Python 3.12 + venv
- [ ] Instalaste Rust stable (para Tauri)
- [ ] Tienes acceso a `bd_facturacion_local` o BD staging
- [ ] Leíste [CLAUDE.md](../CLAUDE.md)
- [ ] Ejecutaste `pnpm install` + `pip install -e backend[dev]`
- [ ] Iniciaste backend (uvicorn) y frontend (tauri dev)
- [ ] Ves el mapa cargando distritos
- [ ] Pasaste tests: `pnpm test` + `pytest backend/tests`

---

## Stack Rápido

| Capa | Tech | Versión |
|------|------|---------|
| **UI** | React | 19.2.8 |
| **Mapas** | MapLibre GL | 5.24.0 |
| **Styling** | Tailwind CSS | 4.3.3 |
| **Desktop** | Tauri | 2.0 |
| **Backend** | FastAPI | 0.116.1 |
| **Database** | PostgreSQL + PostGIS | 15+ |
| **Type safety** | TypeScript + Pydantic | - |
| **Tests** | Vitest + pytest | - |

---

## Próximos Pasos

1. **Lee [ARCHITECTURE.md](./ARCHITECTURE.md)** para entender cómo fluyen los datos
2. **Usa [GRAPHIFYY_GUIDE.md](./GRAPHIFYY_GUIDE.md)** para visualizar dependencias
3. **Contribuye**: Elige un issue y abre un PR
4. **Pregunta**: Revisa CLAUDE.md sección de troubleshooting

---

**¿Atascado?** Ver [CLAUDE.md § Troubleshooting](../CLAUDE.md#-troubleshooting)

**Última actualización**: 31 de julio, 2025
