# PROJECT DESCRIPTION — Peralta I Bearing Monitoring Dashboard

## Resumen ejecutivo

Aplicación web Flask para monitorear el estado de rodamientos de 50 aerogeneradores (PSP-01 a PSP-50) en el parque eólico Peralta I. El sistema centraliza datos de dos fuentes Excel (actualización periódica de categorías y logbook ROTORsoft), los transforma en JSON y los sirve a un dashboard de una sola página con tres vistas: resumen ejecutivo, mapa de estado y detalle por turbina.

---

## 1. Árbol completo de carpetas y archivos

```
Peralta-Rodamientos/
│
├── server.py                                    # Servidor Flask principal
├── requirements.txt                             # Dependencias Python
├── Procfile                                     # Comando de inicio para Railway/Heroku
├── .gitignore
│
├── Peralta_I_Actualizacion_Rodamientos.xlsx     # Input Excel (NO en git, se sube desde admin)
├── ROTORsoft_Logbook.xlsx                       # Input Excel (NO en git, se sube desde admin)
│
├── parsers/
│   ├── parse_actualizacion.py                   # Parser Excel → estado_actual.json + warnings.json
│   └── parse_logbook.py                         # Parser ROTORsoft logbook → warnings.json
│
├── templates/
│   ├── login.html                               # Página de login
│   ├── index.html                               # Dashboard principal (3 tabs)
│   └── admin.html                              # Panel admin (upload + download)
│
├── static/
│   ├── app.js                                   # Toda la lógica frontend (~917 líneas, vanilla JS)
│   └── style.css                               # Estilos (473 líneas, CSS variables dark theme)
│
├── data/                                        # JSONs en runtime (carpeta IGNORADA en git)
│   ├── estado_actual.json
│   ├── warnings.json
│   └── historico_rodamientos.json
│
└── data_seed/                                   # JSONs semilla (EN git, se copian a /data al inicio)
    ├── estado_actual.json
    ├── warnings.json
    └── historico_rodamientos.json
```

> **Nota:** Los `.xlsx` están en `.gitignore`. Se suben desde el panel de admin en runtime y quedan en la raíz del proyecto.

---

## 2. Scripts Python

### `server.py` (293 líneas)

**Qué hace:** Servidor Flask con autenticación por sesión, dos roles (admin/client), rutas para servir el dashboard y para recibir uploads de Excel.

**Archivos que lee:**
- `data/estado_actual.json`, `data/warnings.json`, `data/historico_rodamientos.json` → los sirve en `/data/<filename>`
- `data_seed/*.json` → los copia a `data/` si `data/` no existe (función `init_data()`)
- `templates/*.html` → rendereados por Jinja2
- `static/app.js` y `static/style.css` → embebidos en `/download-html`

**Archivos que genera:**
- `data/*.json` (indirectamente, via subprocesos de los parsers)
- Respuesta HTML auto-contenida en `/download-html` (no se guarda en disco)

**Rutas Flask:**

| Ruta | Método | Acceso | Descripción |
|------|--------|--------|-------------|
| `/login` | GET, POST | Público | Formulario de login; valida credenciales de env vars |
| `/logout` | GET | Autenticado | Limpia sesión → redirige a `/login` |
| `/` | GET | Autenticado | Dashboard principal; si es admin → redirige a `/admin` |
| `/admin` | GET | Solo admin | Panel de carga de archivos y descarga |
| `/upload` | POST | Solo admin | Recibe los dos `.xlsx`, corre los parsers, devuelve JSON resultado |
| `/download-html` | GET | Solo admin | Genera HTML auto-contenido con todos los datos embebidos |
| `/data/<filename>` | GET | Autenticado | Sirve JSONs de la carpeta `data/` |
| `/dashboard` | GET | Solo admin | Ruta alternativa al dashboard |

**Variables de entorno leídas:** `SECRET_KEY`, `ADMIN_USER`, `ADMIN_PASS`, `CLIENT_USER`, `CLIENT_PASS`, `PORT`

---

### `parsers/parse_actualizacion.py` (317 líneas)

**Qué hace:** Lee el Excel principal y genera `estado_actual.json` y `warnings.json`.

**Archivos que lee:**
- `Peralta_I_Actualizacion_Rodamientos.xlsx` (4 hojas)

**Archivos que genera:**
- `data/estado_actual.json`
- `data/warnings.json`

**Hojas Excel procesadas:**

| Hoja | Fila header | Datos desde | Propósito |
|------|-------------|-------------|-----------|
| `Estado_Rodamientos` | Fila 4 | Fila 5 | Estado actual de cada turbina |
| `Nuevo_Control_De_Rodamientos` | Fila 1 | Fila 2 | Nuevas mediciones; columnas PSP-01…PSP-50 con 'X' |
| `Warnings_por_Tipo` | Fila 4 | Fila 5 | Total de warnings por tipo por turbina |
| `Warnings_Mensuales` | Fila 4 | Fila 5 | Total warnings por mes por turbina |

**Funciones principales:**
- `fmt_fecha(v)` → convierte datetime a `"YYYY-MM-DD"` o `None`
- `limpiar(v)` → strip y None si vacío
- `parsear_estado()` → lee `Estado_Rodamientos` → dict base por turbina
- `parsear_nuevo_control()` → lee `Nuevo_Control_De_Rodamientos` → aplica sobreescritura a turbinas con 'X'
- `aplicar_nuevo_control(estado, nuevo)` → mergea datos nuevos al estado base
- `parsear_warnings()` → lee las dos hojas de warnings → estructura `warnings.json`

---

### `parsers/parse_logbook.py` (257 líneas)

**Qué hace:** Lee el logbook de ROTORsoft, extrae eventos de advertencia relevantes, y los fusiona en `warnings.json` por turbina y mes.

**Archivos que lee:**
- `ROTORsoft_Logbook.xlsx` (leído con pandas)
- `data/warnings.json` (para fusionar con datos existentes)

**Archivos que genera:**
- `data/warnings.json` (actualizado con nuevos meses)

**Códigos de error rastreados:**

| Código | Nombre en sistema |
|--------|-------------------|
| 58.2 | Lub. Sin presión |
| 58.5 | Lub. Sin pres.(aux) |
| 58.1 | Grasa vacío |
| 50.23 | Ruido Nacelle |
| 50.19 | Sensor acúst. |
| 72.99 | Air Gap |

**Funciones principales:**
- `extraer_turbina(s)` → `"PSP-30 E920293"` → `"PSP-30"`
- `extraer_codigo(s)` → `"[58.2] Fault..."` → `"58.2"`
- `formato_mes(s)` → `"2026-03"` → `"Mar'26"`
- `filtrar_logbook(path)` → filtra y agrega por turbina/mes
- `detectar_cambios(nuevo, existente)` → identifica meses nuevos vs. conflictivos
- `fusionar(nuevo, existente, forzar)` → escribe datos nuevos; pide confirmación si hay conflictos

**Args CLI:**
```bash
python parsers/parse_logbook.py --archivo ROTORsoft_Logbook.xlsx [--forzar]
```
(En producción se llama via subprocess desde `/upload` sin `--forzar`)

---

## 3. Estructura exacta de cada JSON

### `data/estado_actual.json`

**Nivel superior:** objeto con claves `"PSP-01"` a `"PSP-50"`

```json
{
  "PSP-01": {
    "cat_del":                "A",           // string | null  — categoría rodamiento delantero
    "cat_tras":               "A",           // string | null  — categoría rodamiento trasero
    "fecha_ultima":           "2025-04-23",  // "YYYY-MM-DD" | null
    "tipo_ultima":            "Mant. Master 2025", // string | null — tipo de medición
    "cambio_frontal":         null,          // "YYYY-MM-DD" | null — fecha cambio rod. frontal
    "cambio_trasero":         null,          // "YYYY-MM-DD" | null — fecha cambio rod. trasero
    "insp_joao_fecha":        null,          // "YYYY-MM-DD" | null
    "insp_joao_clase":        null,          // string | null
    "insp_joao_comentario":   null,          // string | null
    "parada_retrofit_dias":   36,            // number | null — días de parada en retrofit
    "nueva_fecha":            null,          // "YYYY-MM-DD" | null — próxima medición planificada
    "nuevo_tipo":             null,          // string | null
    "nueva_cat_del":          null,          // string | null — categoría esperada del.
    "nueva_cat_tras":         null,          // string | null — categoría esperada tras.
    "comentarios_nuevos":     null           // string | null
  },
  "PSP-02": { ... }
}
```

**Valores posibles para categorías** (`cat_del`, `cat_tras`):
`"A"` (OK), `"B"` (Seguimiento), `"C"` (Seg. prioritario), `"D"` (Cambio planificado), `"E"` (Urgente), `"F"` (Deterioro completo), `"ND"` (No determinado)

---

### `data/warnings.json`

**Nivel superior:** objeto con claves `"PSP-01"` a `"PSP-50"`

```json
{
  "PSP-01": {
    "cat_tras": "A",           // string — categoría trasera (espejo de estado_actual)
    "por_tipo": {              // object — total acumulado por tipo de warning
      "Lub. Sin presión":      56,
      "Lub. Sin pres.(aux)":   6,
      "Grasa vacío":           16,
      "Ruido Nacelle":         1,
      "Sensor acúst.":         6,
      "Air Gap":               0
    },
    "mensual": {               // object — total warnings por mes (todas las claves presentes para todas las turbinas)
      "Ene'25": 2,
      "Feb'25": 1,
      "Mar'25": 32,
      "Abr'25": 16,
      "May'25": 8,
      "Jun'25": 0,
      "Jul'25": 3,
      "Ago'25": 5,
      "Sep'25": 0,
      "Oct'25": 7,
      "Nov'25": 4,
      "Dic'25": 2,
      "Ene'26": 3,
      "Feb'26": 1,
      "Mar'26": 0
    },
    "nuevo_mes_fecha": null,   // string | null — campo para mes nuevo no procesado aún
    "nuevo_mes_total": null,   // number | null
    "total_warnings": 85       // number — suma de todos los valores en "mensual"
  },
  "PSP-02": { ... }
}
```

> El conjunto de meses en `"mensual"` puede crecer cuando se sube un nuevo logbook. El frontend deriva el orden cronológico de las claves mediante `derivarMeses()`.

---

### `data/historico_rodamientos.json`

**Nivel superior:** objeto con claves `"PSP-01"` a `"PSP-50"`

```json
{
  "PSP-04": {
    "cambio_frontal":        "2019-10-21",   // "YYYY-MM-DD" | null
    "cambio_trasero":        "2024-08-11",   // "YYYY-MM-DD" | null
    "parada_retrofit_dias":  35,             // number | null
    "insp_joao": {
      "realizada":    false,                 // boolean
      "fecha":        null,                  // "YYYY-MM-DD" | null
      "comentario":   null                   // string | null
    },
    "medidas": [                             // array — historial cronológico de mediciones
      {
        "fecha":    "2025-02-19",            // "YYYY-MM-DD"
        "tipo":     "Mant. Master 2025",     // string
        "cat_del":  "ND",                    // string
        "cat_tras": "ND"                     // string
      },
      {
        "fecha":    "2026-02-04",
        "tipo":     "Mantenimiento Master",
        "cat_del":  "A",
        "cat_tras": "A"
      }
    ],
    "comentarios":           null,           // string | null
    "plan_accion_enercon":   null            // string | null — campo reservado, sin uso activo
  }
}
```

> `historico_rodamientos.json` se sirve al frontend pero actualmente **no es regenerado por los parsers** — se mantiene como semilla manual. Los parsers sólo tocan `estado_actual.json` y `warnings.json`.

---

## 4. Estructura del frontend

### `templates/login.html`
- Formulario de login con campo usuario + contraseña
- Tema oscuro (CSS inline)
- POST a `/login`; muestra mensaje de error si las credenciales fallan
- Sin dependencias JS externas

### `templates/index.html`
- Layout del dashboard: navbar sticky + 3 contenedores de página
- Navbar: logo SVG animado, tabs "Resumen" / "Mapa Estado" / "Por Turbina", botón "Actualizar datos" (solo si es admin, enlaza a `/admin`)
- Los tabs activan `goToPage(id)` en app.js
- Carga: `/static/style.css` y `/static/app.js`
- Overlay de carga con spinner visible hasta que `init()` termina

### `templates/admin.html`
- Dos `<input type="file" accept=".xlsx">`: uno para actualización de rodamientos, otro para logbook ROTORsoft
- Botón de submit → POST multipart a `/upload`
- Muestra respuesta del servidor (éxito o error por parser)
- Muestra "Último update" (timestamp del servidor)
- Botón "Descargar HTML" → GET `/download-html`
- Todo CSS y JS es inline (no depende de static/)

### `static/style.css` (473 líneas)

**Variables CSS (dark theme):**
```css
--bg:  #0d1117   /* fondo principal */
--s1:  #161b22   /* superficies nivel 1 */
--s2:  #1c2128   /* superficies nivel 2 */
--s3:  #222a33   /* superficies nivel 3 */
--b1:  #2a3a4a   /* borde principal */
--b2:  #344a5e   /* borde secundario */
--t1:  #e6edf3   /* texto primario */
--t2:  #adbac7   /* texto secundario */
--t3:  #768899   /* texto muted */
--ac:  #4da6ff   /* acento azul */
```

**Fuentes:** `DM Mono` (código/números), `DM Sans` (UI general) — importadas desde Google Fonts

**Componentes principales:**
- Navbar sticky con logo, tabs y botones de acción
- Grid de turbinas (auto-fill, celdas 72px) para Mapa Estado
- Sidebar fijo (izquierda) + panel de detalle (derecha) para Por Turbina
- Barras mensuales con marcadores de eventos superpuestos
- Cards con header y bordes
- Animación spin (logo) y fadeIn (entradas)

### `static/app.js` (917 líneas)

**Estado global:**
```javascript
let estado = {};          // estado_actual.json
let warnings = {};        // warnings.json
let historico = {};       // historico_rodamientos.json
let MESES_KEYS = [];      // ["Ene'25", "Feb'25", ...] en orden cronológico
let MESES_LABELS = [];    // igual que MESES_KEYS
let turbinaSeleccionada;  // ID turbina actualmente seleccionada
let turbinaFiltro = 'all';
let mapaBuilt = false;    // flag lazy-load
let turbinaBuilt = false; // flag lazy-load
```

**Carga de datos:**
- `loadData()` → fetch paralelo de los 3 JSONs vía `/data/<file>` (o lee `window.__STATIC_DATA__` si es HTML standalone)
- `derivarMeses()` → extrae todas las claves de `mensual` de todas las turbinas y las ordena cronológicamente

**Constantes de color:**
```javascript
CAT_COLORS = {
  A: '#3dffa0', B: '#ffcc00', C: '#ff8c00',
  D: '#ff4d4d', E: '#cc0000', F: '#880000', ND: '#3d5f80'
}
SUBTIPO_COLORES = {
  'Lub. Sin presión':    '#e8922e',
  'Lub. Sin pres.(aux)': '#c4750f',
  'Grasa vacío':         '#d4660a',
  'Ruido Nacelle':       '#38b0f8',
  'Sensor acúst.':       '#4878a8',
  'Air Gap':             '#d64ebe'
}
```

**Funciones organizadas por vista:**

| Función | Vista | Descripción |
|---------|-------|-------------|
| `init()` | Global | Registra handlers de tabs, carga datos, construye Resumen |
| `goToPage(id)` | Global | Cambia tab activo; lazy-load Mapa y Por Turbina |
| `goToTurbina(id)` | Global | Salta directamente a una turbina en Por Turbina |
| `buildResumen()` | Resumen | Construye las tres secciones del resumen |
| `buildResumenEstadoActual()` | Resumen | Barras de distribución por categoría (A/B/C/D/ND) |
| `buildResumenCriticas()` | Resumen | Lista turbinas con cat_tras ≠ A, últimos 3 meses warnings |
| `buildStackedSegments(id, ...)` | Resumen | Barra apilada proporcional por subtipo de warning |
| `buildMapa()` | Mapa | Grid 50 turbinas con badges cat_del/cat_tras |
| `toggleMapa(id)` | Mapa | Expande/colapsa panel de detalle inline |
| `buildTurbina()` | Por Turbina | Sidebar + panel vacío |
| `filtrarListaTurbinas()` | Por Turbina | Filtra sidebar por texto y categoría |
| `seleccionarTurbina(id)` | Por Turbina | Destaca turbina en sidebar y renderiza detalle |
| `renderDetalleTurbina(id)` | Por Turbina | Llama a buildPanelDetalle para el panel derecho |
| `buildPanelDetalle(id, botonCerrar)` | Compartida | Card completa de detalle de una turbina |
| `buildBarrasMensuales(id)` | Compartida | 15 meses de warnings + líneas de evento superpuestas |
| `buildEventosPorMes(id)` | Compartida | Mapea fechas de eventos (mantenimientos, cambios) a meses |
| `buildSubgrupoBars(id)` | Compartida | Barras horizontales por subtipo de warning |
| `buildTimeline(id)` | Compartida | Tabla cronológica de mediciones y eventos |
| `buildImpactoCambio(id)` | Compartida | Comparativa warnings antes/después de cambio de rodamiento |
| `catBadge(cat, small)` | Helper | `<span>` con color por categoría |
| `fechaAMesLabel(fecha)` | Helper | `"2025-01-15"` → `"Ene'25"` |
| `mesIndex(label)` | Helper | Índice de un mes en MESES_KEYS |
| `getWarningMes(id, idx)` | Helper | Warnings de turbina en mes por índice |
| `totalWarnings(id)` | Helper | Suma total de warnings de turbina |

---

## 5. Cómo correr el proyecto localmente

```bash
# 1. Clonar e instalar dependencias
git clone <repo-url>
cd Peralta-Rodamientos
pip install -r requirements.txt

# 2. (Opcional) Definir credenciales
export ADMIN_USER=admin
export ADMIN_PASS=admin123
export CLIENT_USER=peralta
export CLIENT_PASS=peralta123
export SECRET_KEY=clave-secreta-local

# 3. Iniciar el servidor
python server.py
# → http://0.0.0.0:5000  (debug=True en dev)

# 4. Login
# - Admin: admin / admin123
# - Cliente: peralta / peralta123

# 5. Para parsear datos manualmente (sin subir desde admin):
#    Colocar los Excel en la raíz del proyecto y correr:
python parsers/parse_actualizacion.py
python parsers/parse_logbook.py --archivo ROTORsoft_Logbook.xlsx
```

Al primer inicio, `init_data()` copia `data_seed/*.json` → `data/` automáticamente si la carpeta no existe.

---

## 6. Deploy en Railway

### Archivos de configuración

**`Procfile`:**
```
web: gunicorn server:app --bind 0.0.0.0:$PORT
```
Railway lee el `Procfile` y ejecuta este comando. `$PORT` es asignado dinámicamente por Railway.

**`requirements.txt`:**
```
flask
gunicorn
openpyxl
pandas
```
Railway detecta Python automáticamente por la presencia de `requirements.txt` y corre `pip install -r requirements.txt`.

No hay `railway.toml`, `nixpacks.toml`, ni `railway.json` en el proyecto — Railway usa detección automática.

### Variables de entorno en Railway

Configurar en el panel de Railway → Service → Variables:

| Variable | Descripción | Default (inseguro) |
|----------|-------------|-------------------|
| `SECRET_KEY` | Clave para firmar sesiones Flask | `'aqwertyuiopasdfghjlzxcvbnmm'` |
| `ADMIN_USER` | Usuario administrador | `'admin'` |
| `ADMIN_PASS` | Contraseña administrador | `'admin123'` |
| `CLIENT_USER` | Usuario cliente | `'peralta'` |
| `CLIENT_PASS` | Contraseña cliente | `'peralta123'` |
| `PORT` | Puerto HTTP (Railway lo inyecta automáticamente) | `5000` |

> Los archivos Excel y los JSONs en `data/` **no persisten** entre redeployments en Railway (filesystem efímero). Los JSONs semilla en `data_seed/` sí persisten porque están en el repo. Para mantener datos entre deploys habría que montar un volumen o usar un store externo.

---

## 7. Dependencias externas

### `requirements.txt`
```
flask        # Framework web
gunicorn     # Servidor WSGI para producción
openpyxl     # Lectura de archivos .xlsx en parse_actualizacion.py
pandas       # Lectura de archivos .xlsx en parse_logbook.py
```

Todas las demás dependencias de `flask`, `gunicorn`, `openpyxl` y `pandas` se instalan automáticamente como sub-dependencias.

### Frontend
- **Google Fonts** (CDN): `DM Mono` y `DM Sans` — cargadas desde `fonts.googleapis.com` en `style.css`
- Sin npm, sin bundler, sin frameworks JS. Todo es vanilla JavaScript en un único `app.js`.

### Python stdlib usada
- `os`, `subprocess`, `json`, `shutil`, `datetime` — sin instalación adicional.

---

## 8. Flujo de datos completo

```
ADMIN sube Excel desde /admin
    │
    ▼
POST /upload
    ├── guarda Peralta_I_Actualizacion_Rodamientos.xlsx
    ├── guarda ROTORsoft_Logbook.xlsx
    ├── subprocess: python parsers/parse_actualizacion.py
    │       └── lee Excel → escribe data/estado_actual.json
    │                     → escribe data/warnings.json
    └── subprocess: python parsers/parse_logbook.py
            └── lee Excel + lee data/warnings.json
                → escribe data/warnings.json (fusiona meses nuevos)

CLIENTE (o admin) carga el dashboard /
    │
    ▼
index.html → carga app.js
    │
    ├── fetch /data/estado_actual.json
    ├── fetch /data/warnings.json
    └── fetch /data/historico_rodamientos.json
            │
            ▼
        buildResumen()   → tab "Resumen"
        buildMapa()      → tab "Mapa Estado"  (lazy)
        buildTurbina()   → tab "Por Turbina"  (lazy)
```

---

## 9. Notas de arquitectura y limitaciones conocidas

- **`historico_rodamientos.json` es sólo semilla manual.** Los parsers no lo regeneran. Si se quiere actualizar el historial hay que editar el JSON directamente o extender los parsers.
- **Sin persistencia en Railway.** El filesystem de Railway es efímero. Los Excel subidos y los JSONs de `data/` se pierden en cada redeploy. Solución propuesta: montar un volume en Railway o migrar a base de datos.
- **Un solo admin.** Hay una única cuenta admin (no multi-usuario). Credenciales en variables de entorno.
- **`parse_logbook.py` pide confirmación interactiva** si detecta meses conflictivos. Cuando se llama desde `/upload` (subprocess sin TTY) esto puede causar que el proceso quede colgado. Mitigación actual: no se pasa `--forzar` y se asume que el logbook siempre trae meses nuevos.
- **`plan_accion_enercon`** en `historico_rodamientos.json` existe como campo reservado pero no se usa en el frontend.
- **HTML standalone** (`/download-html`): server.py lee los tres JSONs, los incrusta como `window.__STATIC_DATA__` en un `<script>` dentro del HTML, y embebe el CSS y JS completos. El archivo resultante funciona sin servidor.
