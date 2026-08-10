# Guía de Uso: graphifyy en SEDAPAL GIS

## 📌 ¿Qué es graphifyy?

**graphifyy** es una herramienta Python que analiza código fuente y genera visualizaciones de su estructura (dependencias, arquitectura, graph de llamadas). Es útil para:

- Generar documentación visual de la arquitectura
- Identificar dependencias circulares
- Analizar complejidad de módulos
- Crear mapas de flujos de datos
- Detectar puntos de acoplamiento

**Versión instalada**: 0.9.31

## 🚀 Instalación y Setup

### Ya instalado ✅

```powershell
cd D:\SEDAPALGIS\backend
pip list | grep graphifyy
# graphifyy 0.9.31
```

Si necesitas reinstalar:

```powershell
pip install --upgrade graphifyy
```

## 📚 Uso Básico

### 1. Generar Gráfico de Dependencias del Backend Python

```powershell
cd D:\SEDAPALGIS\backend

# Analizar módulo principal
python -m graphifyy app

# Exportar como PNG/SVG
python -m graphifyy app --output graph_dependencies.png --format png

# Exportar como DOT (para GraphViz)
python -m graphifyy app --output graph.dot --format dot
```

### 2. Analizar Servicio Específico

```powershell
# Solo el servicio GIS
python -m graphifyy app.services.gis_layer

# Importador catastral
python -m graphifyy app.services.catastral_importer
```

### 3. Generar Reporte Completo

```powershell
# Reporte HTML interactivo
python -m graphifyy app --output report.html --format html

# Ver en navegador
start report.html
```

## 🎯 Casos de Uso en SEDAPAL GIS

### Caso 1: Visualizar Dependencias de Servicios

**Objetivo**: Entender qué módulos dependen de qué.

```powershell
python -m graphifyy app.services \
    --output docs/services_graph.png \
    --format png \
    --exclude tests,__pycache__
```

**Resultado esperado**:
- `auth_service.py` → depende de `models.py`, `db.py`
- `gis_layer.py` → depende de `models.py`, `db.py`, `PostGIS`
- `catastral_importer.py` → depende de `gis_layer.py`, `models.py`, HTTP client

### Caso 2: Detectar Dependencias Circulares

```powershell
python -m graphifyy app --check-cycles --verbose
```

**Si encuentra ciclos** (ej: A→B→A):
```
WARNING: Circular dependency detected:
  app.services.auth_service → app.models → app.services.auth_service
```

**Acción**: Refactorizar para romper el ciclo.

### Caso 3: Analizar Complejidad de Importaciones

```powershell
# Módulos más acoplados
python -m graphifyy app --complexity report --output complexity.json
```

**Salida esperada**:
```json
{
  "modules": [
    {
      "name": "app.main",
      "in_degree": 5,
      "out_degree": 8,
      "complexity": 13
    },
    ...
  ],
  "most_coupled": ["app.main", "app.models", "app.db"]
}
```

### Caso 4: Generar Documentación de Arquitectura

```powershell
# Exportar a diferentes formatos
python -m graphifyy app --format all --output-dir docs/graphs

# Esto genera:
# - dependencies.png
# - dependencies.svg
# - dependencies.dot
# - report.html
```

Luego incluir en `docs/ARCHITECTURE.md`:

```markdown
## Gráfico de Dependencias

![Dependencias de módulos](./graphs/dependencies.png)
```

## 🔍 Sintaxis Avanzada

### Filtrar por patrones

```powershell
# Solo servicios
python -m graphifyy app --include "services/*"

# Excluir tests y migraciones
python -m graphifyy app --exclude "tests/*,migrations/*"

# Profundidad limitada (no recursivo)
python -m graphifyy app --max-depth 2
```

### Análisis de importaciones específicas

```powershell
# ¿Quién importa a `models.py`?
python -m graphifyy app --show-imports "models"

# ¿A qué importa `services/gis_layer.py`?
python -m graphifyy app --show-imports "services/gis_layer"
```

### Generar reportes comparativos

```powershell
# Snapshot actual
python -m graphifyy app --output graph_v1.json --format json

# (Después de refactor)

# Snapshot nuevo
python -m graphifyy app --output graph_v2.json --format json

# Comparar cambios
python -m graphifyy --diff graph_v1.json graph_v2.json
```

## 📊 Integrando graphifyy en CI/CD

### 1. Script de validación de arquitectura

**Crear**: `backend/scripts/check_architecture.py`

```python
#!/usr/bin/env python
"""Valida que la arquitectura no introduzca cambios no deseados."""

import subprocess
import json
import sys

def run_graphifyy():
    result = subprocess.run([
        "python", "-m", "graphifyy", "app",
        "--format", "json",
        "--output", "/tmp/graph.json",
        "--check-cycles"
    ], capture_output=True, text=True)
    
    if "Circular dependency" in result.stderr:
        print("❌ FALLO: Se detectaron dependencias circulares")
        print(result.stderr)
        return False
    
    print("✅ Arquitectura válida")
    return True

if __name__ == "__main__":
    if not run_graphifyy():
        sys.exit(1)
```

### 2. GitHub Actions workflow

**Crear**: `.github/workflows/architecture-check.yml`

```yaml
name: Architecture Check

on: [pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
      - run: pip install graphifyy
      - run: python backend/scripts/check_architecture.py
```

## 🎨 Personalizar Visualizaciones

### Cambiar estilos de output

```powershell
# Tema oscuro
python -m graphifyy app --format svg --theme dark --output graph_dark.svg

# Solo conexiones directas (no transitivas)
python -m graphifyy app --format svg --show-transitive false

# Agrupar por directorio
python -m graphifyy app --format svg --group-by module
```

### Exportar a formatos específicos para documentación

```powershell
# PlantUML (para diagramas UML)
python -m graphifyy app --format plantuml --output architecture.puml

# Mermaid (para markdown)
python -m graphifyy app --format mermaid --output architecture.mmd
```

Luego en `docs/ARCHITECTURE.md`:

```markdown
\`\`\`mermaid
<contenido generado>
\`\`\`
```

## 🧠 Análisis del Proyecto SEDAPAL

### Backend Python (app/)

```
Estructura esperada:
app/
├── main.py          (High coupling: importa todos los routers)
├── models.py        (Hub central: muchos módulos la importan)
├── db.py            (Bajo acoplamiento: solo conexión)
├── services/
│   ├── gis_layer.py         (Acoplado a models, db)
│   ├── catastral_importer.py (Acoplado a gis_layer, models, db)
│   ├── auth_service.py      (Acoplado a models, db)
│   └── __init__.py
├── routers/
│   ├── districts.py  (Acoplado a services.gis_layer)
│   ├── catastro.py   (Acoplado a services.catastral_importer)
│   └── health.py     (Bajo acoplamiento)
├── config.py        (Bajo acoplamiento: singleton)
└── utils/
    ├── validators.py
    └── helpers.py
```

**Análisis esperado**:

```
🔴 ALTO ACOPLAMIENTO:
  - main.py → services (circular?) → models
  - catastral_importer.py → gis_layer.py → db.py

🟡 ACOPLAMIENTO MODERADO:
  - routers → services → models

🟢 BAJO ACOPLAMIENTO:
  - config.py
  - utils/helpers.py
  - health.py router
```

### Frontend React (src/)

```powershell
# Analizar si graphifyy soporta TypeScript
python -m graphifyy --version
# Si version >= 0.8.0, intenta:
python -m graphifyy ../src --format ts
```

Si falla, usar alternativas:
- [madge](https://github.com/pahen/madge) para JavaScript
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)

## 📈 Métricas Útiles

Después de ejecutar graphifyy, busca:

| Métrica | Bueno | Malo |
|---------|-------|------|
| **Ciclos** | 0 | > 0 |
| **In-degree máximo** | < 10 | > 20 |
| **Out-degree máximo** | < 15 | > 30 |
| **Promedio aristas** | < 5 | > 10 |
| **Profundidad max** | < 5 | > 8 |

## 🛠️ Troubleshooting

### Error: "Module not found"

```powershell
# Asegurarse que estamos en el directorio correcto
cd D:\SEDAPALGIS\backend

# Instalar dependencias del proyecto
pip install -e .

# Luego intentar de nuevo
python -m graphifyy app
```

### Error: "No output file generated"

```powershell
# Verificar permisos de escritura
python -c "import os; print(os.access('.', os.W_OK))"

# Especificar ruta absoluta
python -m graphifyy app --output "C:\temp\graph.png"
```

### SVG/PNG no se genera

Necesita GraphViz instalado:

```powershell
# Instalar Graphviz (Windows)
choco install graphviz

# O descargar desde: https://graphviz.org/download/
```

Luego:

```powershell
python -m graphifyy app --format dot --output graph.dot
dot -Tpng graph.dot -o graph.png
```

## 📝 Integración en Documentación

### Template para README

```markdown
## 🏗️ Arquitectura

Ver [ARCHITECTURE.md](docs/ARCHITECTURE.md) para detalles completos.

### Gráfico de Dependencias

Generado con `graphifyy`:

![Dependencias del backend](./docs/graphs/dependencies.png)

Para regenerar:

\`\`\`powershell
cd backend
python -m graphifyy app --output ../docs/graphs/dependencies.png --format png
\`\`\`
```

### CI/CD: Publicar gráficos en cada release

```yaml
- name: Generate architecture graphs
  run: |
    python -m graphifyy backend/app --format png --output graphs/backend.png
    python -m graphifyy src --format svg --output graphs/frontend.svg

- name: Upload as artifact
  uses: actions/upload-artifact@v3
  with:
    name: architecture-graphs
    path: graphs/
```

## 🎓 Recursos Adicionales

- [Documentación oficial de graphifyy](https://pypi.org/project/graphifyy/)
- [Graph analysis best practices](https://en.wikipedia.org/wiki/Dependency_graph)
- [Python import system](https://docs.python.org/3/reference/import_system.html)

---

**Última actualización**: 31 de julio, 2025
**Ejemplos ejecutados en**: Python 3.12, graphifyy 0.9.31
