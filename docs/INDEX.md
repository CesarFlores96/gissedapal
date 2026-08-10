# 📚 Índice de Documentación - SEDAPAL GIS

Bienvenido a la documentación completa de SEDAPAL GIS. Este índice te guía hacia el documento que necesitas.

---

## 🚀 Comienza Aquí

### 🆕 Primer Día?
**→ [QUICKSTART.md](./QUICKSTART.md)** (5 minutos)

Instrucciones rápidas para instalar, configurar y ejecutar la aplicación localmente.

- ✅ Setup inicial
- ✅ Primeros cambios
- ✅ Comandos esenciales
- ✅ Debugging rápido

---

## 📖 Documentación Principal

### 📋 [CLAUDE.md - Guía Completa](../CLAUDE.md)
**Para**: Comprensión holística del proyecto

Contiene:
- Resumen general y stack tecnológico
- Estructura completa de directorios
- Instalación y configuración detallada
- Base de datos (migraciones, capas)
- Ejecución en desarrollo
- Todas las dependencias (Node.js, Python, Rust)
- Tests y build
- Tipos de datos y API endpoints
- Seguridad y autenticación
- Troubleshooting común
- Convenciones de código

**Cuando leer**: Primer día, antes de hacer commits

---

### 🏗️ [ARCHITECTURE.md - Arquitectura Técnica](./ARCHITECTURE.md)
**Para**: Entender cómo está diseñado el sistema

Contiene:
- Diagrama de componentes (ASCII)
- Flujos de datos típicos
- Capas de la aplicación (Presentación, Lógica, Persistencia)
- Patrones de diseño (Service Layer, IPC Commands, Hooks)
- Flujos de autenticación (JWT, RBAC)
- Escalabilidad y optimizaciones
- Monitoreo y logging
- Configuración por entorno

**Cuando leer**: Antes de diseñar nuevas features, refactorizar

---

### 🔍 [GRAPHIFYY_GUIDE.md - Análisis de Código](./GRAPHIFYY_GUIDE.md)
**Para**: Visualizar y analizar la estructura de código

Contiene:
- Qué es graphifyy y por qué usarlo
- Instalación (ya completada ✅)
- Casos de uso prácticos:
  - Visualizar dependencias entre módulos
  - Detectar ciclos
  - Analizar complejidad
  - Generar documentación visual
- Sintaxis avanzada y filtros
- Integración en CI/CD
- Troubleshooting
- Análisis esperado del proyecto SEDAPAL

**Cuando leer**: Cuando necesites entender dependencias, refactorizar, revisar PR

---

### 📖 [README.md - Setup Original](../README.md)
**Para**: Instalación paso a paso (el histórico)

Contiene:
- Requisitos del sistema
- Preparación (instalación de dependencias)
- Setup de base de datos y migraciones
- Verificación (tests)

**Cuando leer**: Si el QUICKSTART no es suficiente

---

## 🎯 Guía por Rol

### 👨‍💻 Desarrollador Frontend (React)

1. Leer: [QUICKSTART.md](./QUICKSTART.md)
2. Consultar: [CLAUDE.md § Stack Frontend](../CLAUDE.md#stack-tecnológico)
3. Entender: [ARCHITECTURE.md § Capa Presentación](./ARCHITECTURE.md#1-presentación-react--tauri)
4. Visualizar: [GRAPHIFYY_GUIDE.md § Analizar dependencias](./GRAPHIFYY_GUIDE.md#caso-3-analizar-complejidad-de-importaciones)

**Ruta rápida**: QUICKSTART → CLAUDE (types.ts section) → ARCHITECTURE (React patterns)

---

### 🐍 Desarrollador Backend (Python/FastAPI)

1. Leer: [QUICKSTART.md](./QUICKSTART.md)
2. Consultar: [CLAUDE.md § Backend](../CLAUDE.md#-ejecución-en-desarrollo)
3. Entender: [ARCHITECTURE.md § Capa Lógica](./ARCHITECTURE.md#2-lógica-de-negocio-tauri--fastapi)
4. Analizar: [GRAPHIFYY_GUIDE.md § Generar gráficos](./GRAPHIFYY_GUIDE.md#1-generar-gráfico-de-dependencias-del-backend-python)

**Workflow típico**: 
```
Cambio de código
    → python -m graphifyy app
    → Revisar dependencias
    → Hacer commit
```

---

### 🗄️ Ingeniero de Base de Datos

1. Leer: [CLAUDE.md § Base de Datos](../CLAUDE.md#-base-de-datos)
2. Revisar: [README.md § Base de datos](../README.md#base-de-datos)
3. Entender: [ARCHITECTURE.md § Persistencia](./ARCHITECTURE.md#3-persistencia-postgresql--postgis)

**Migraciones**: Ver `backend/migrations/*.sql`

---

### 🏢 Arquitecto / Tech Lead

1. Leer: [ARCHITECTURE.md](./ARCHITECTURE.md) completo
2. Ejecutar: [GRAPHIFYY_GUIDE.md § Análisis](./GRAPHIFYY_GUIDE.md)
3. Consultar: [CLAUDE.md § Características Futuras](../CLAUDE.md#-características-futuras--todos)

**Decisiones de diseño**: Ver ARCHITECTURE.md § Escalabilidad

---

### 🧪 QA / Tester

1. Leer: [QUICKSTART.md](./QUICKSTART.md)
2. Ver: [CLAUDE.md § Tests](../CLAUDE.md#-tests)

**Comandos clave**:
```powershell
pnpm test                          # Frontend tests
pytest backend/tests -v            # Backend tests
pnpm tauri dev                     # Ejecutar app
```

---

### 📊 Gestor de Proyecto

1. Leer: [CLAUDE.md § Resumen General](../CLAUDE.md#-resumen-general)
2. Entender: [ARCHITECTURE.md § Diagrama](./ARCHITECTURE.md#diagrama-de-componentes)
3. Ver: [CLAUDE.md § Stack](../CLAUDE.md#-dependencias-principales)

**Para releases**: Ver `artifacts/` y `dist/`

---

## 🔗 Flujo de Trabajo Estándar

### 1️⃣ Comenzar una Feature

```
Leer QUICKSTART.md
    ↓
Leer CLAUDE.md sección relevante
    ↓
Leer ARCHITECTURE.md si necesitas diseño
    ↓
Empezar a codificar
```

### 2️⃣ Antes de hacer commit

```
Ejecutar tests (pnpm test + pytest)
    ↓
Ejecutar graphifyy (si cambios arquitectónicos)
    ↓
Revisar con CLAUDE.md § Convenciones
    ↓
Commit
```

### 3️⃣ Revisar PR de otro

```
Leer descripción del PR
    ↓
Ejecutar cambios localmente
    ↓
Ver cambios arquitectónicos con graphifyy
    ↓
Comparar con ARCHITECTURE.md
    ↓
Revisar y comentar
```

---

## 📚 Documentos por Tema

### Stack Tecnológico
- [CLAUDE.md § Dependencias](../CLAUDE.md#-dependencias-principales)
- [README.md § Requisitos](../README.md#requisitos)

### Instalación y Setup
- [QUICKSTART.md](./QUICKSTART.md)
- [README.md](../README.md)

### Cómo ejecutar
- [QUICKSTART.md § 3️⃣ Inicia servicios](./QUICKSTART.md#3️⃣-inicia-servicios)
- [CLAUDE.md § Ejecución en Desarrollo](../CLAUDE.md#-ejecución-en-desarrollo)

### Tests
- [CLAUDE.md § Tests](../CLAUDE.md#-tests)
- [QUICKSTART.md § Testing](./QUICKSTART.md#testing)

### Base de Datos
- [CLAUDE.md § Base de Datos](../CLAUDE.md#-base-de-datos)
- [README.md § Base de datos](../README.md#base-de-datos)
- [ARCHITECTURE.md § Persistencia](./ARCHITECTURE.md#3-persistencia-postgresql--postgis)

### Arquitectura
- [ARCHITECTURE.md](./ARCHITECTURE.md) (documento completo)
- [CLAUDE.md § Estructura](../CLAUDE.md#-estructura-del-proyecto)

### APIs y Endpoints
- [CLAUDE.md § API Endpoints](../CLAUDE.md#-api-endpoints)
- [ARCHITECTURE.md § Flujos](./ARCHITECTURE.md#flujo-de-datos-típico)

### Seguridad
- [CLAUDE.md § Seguridad y Autenticación](../CLAUDE.md#-seguridad-y-autenticación)
- [ARCHITECTURE.md § Autenticación](./ARCHITECTURE.md#flujos-de-autenticación)

### Análisis de Código
- [GRAPHIFYY_GUIDE.md](./GRAPHIFYY_GUIDE.md) (documento completo)

### Debugging
- [CLAUDE.md § Troubleshooting](../CLAUDE.md#-troubleshooting)
- [QUICKSTART.md § Debugging](./QUICKSTART.md#debugging)

### Convenciones
- [CLAUDE.md § Convenciones de Código](../CLAUDE.md#-convenciones-de-código)
- [ARCHITECTURE.md § Patrones](./ARCHITECTURE.md#patrones-de-diseño)

---

## 🎓 Recursos Externos

- [React 19 Docs](https://react.dev)
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [Tauri v2 Docs](https://v2.tauri.app)
- [PostgreSQL / PostGIS Docs](https://www.postgresql.org/docs/)
- [MapLibre GL Docs](https://maplibre.org/maplibre-gl-js/)
- [graphifyy PyPI](https://pypi.org/project/graphifyy/)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)

---

## 📝 Estado de la Documentación

| Documento | Estado | Última actualización |
|-----------|--------|---------------------|
| CLAUDE.md | ✅ Completo | 31-Jul-2025 |
| ARCHITECTURE.md | ✅ Completo | 31-Jul-2025 |
| GRAPHIFYY_GUIDE.md | ✅ Completo | 31-Jul-2025 |
| QUICKSTART.md | ✅ Completo | 31-Jul-2025 |
| README.md | ✅ Mantenido | 31-Jul-2025 |

---

## 💡 Sugerencias de Mejora

¿Notas algo incompleto o confuso?

1. Abre un issue con el tag `[docs]`
2. Propón cambios en un PR
3. Sugiere nuevas secciones

---

## 🔍 Búsqueda Rápida

¿Busca algo específico?

| Término | Ver |
|---------|-----|
| "Instalar" | QUICKSTART.md |
| "Dependencies" | CLAUDE.md § Dependencias |
| "Graph" | ARCHITECTURE.md § Diagrama |
| "Error" | CLAUDE.md § Troubleshooting |
| "Test" | CLAUDE.md § Tests |
| "JWT" | ARCHITECTURE.md § Autenticación |
| "MapLibre" | CLAUDE.md § Tipos |
| "graphifyy" | GRAPHIFYY_GUIDE.md |
| "Deploy" | CLAUDE.md § Build |
| "Migraciones" | README.md § Base de datos |

---

**Última actualización**: 31 de julio, 2025  
**Mantenedor**: Equipo SEDAPAL GIS  
**Siguiente revisión**: 30 de septiembre, 2025

