# Peralta I — Monitor de Rodamientos

Dashboard web para el monitoreo de rodamientos del parque eólico Peralta I.

---

## Estructura del proyecto

```
peralta-rodamientos/
├── index.html                          → estructura de la app
├── app.js                              → lógica y renderizado
├── style.css                           → diseño
├── data/
│   ├── estado_actual.json              → estado y última medición por turbina
│   ├── warnings.json                   → historial de warnings mensuales
│   └── historico_rodamientos.json      → historial de medidas y cambios
└── parsers/          ← solo en tu PC, no van al repo
    ├── parse_actualizacion.py
    ├── parse_historico.py
    └── parse_logbook.py
```

---

## Requisitos (solo para quien actualiza los datos)

```bash
pip install openpyxl pandas
```

---

## Actualización mensual — paso a paso

### Paso 1 · Actualizar estado de rodamientos

Completar `Peralta_I_Actualizacion_Rodamientos.xlsx` con los nuevos datos
y correr desde la carpeta raíz del proyecto:

```bash
python parsers/parse_actualizacion.py
```

Actualiza `data/estado_actual.json` y `data/warnings.json`.

---

### Paso 2 · Agregar warnings del ROTORsoft

Descargar el export de ROTORsoft y correr:

```bash
python parsers/parse_logbook.py --archivo ROTORsoft_NombreMes.xlsx
```

El script muestra un resumen de lo que encontró y pide confirmación
antes de modificar `data/warnings.json`.

Si necesitás sobreescribir un mes ya cargado:

```bash
python parsers/parse_logbook.py --archivo ROTORsoft_NombreMes.xlsx --forzar
```

---

### Paso 3 · Publicar

```bash
git add data/
git commit -m "Actualización Abril 2026"
git push
```

Netlify detecta el push y redespliega automáticamente en ~1 minuto.
El cliente ve los datos nuevos al recargar la página.

---

## Primer deploy en Netlify

1. Subir este repositorio a GitHub
2. Entrar a [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**
3. Seleccionar el repositorio
4. **Build command:** dejar vacío
5. **Publish directory:** `.` (punto — carpeta raíz)
6. Click **Deploy site**
7. Opcional: cambiar el nombre en **Site Settings → Site name**

La URL resultante (`https://tu-sitio.netlify.app`) es la que le mandás al cliente.

---

## Códigos de warning incluidos

| Código | Nombre |
|--------|--------|
| 58.2   | Lub. Sin presión |
| 58.5   | Lub. Sin pres.(aux) |
| 58.1   | Grasa vacío |
| 50.23  | Ruido Nacelle |
| 50.19  | Sensor acúst. |
| 72.99  | Air Gap |

Excluidos: `50.13` (Ruido en Spinner) y `50.18` (Sensor acústico desactivado).

---

## Clasificación de rodamientos

| Categoría | Significado |
|-----------|-------------|
| A | OK — sin acción |
| B | Seguimiento |
| C | Seguimiento prioritario |
| D | Planificar cambio |
| E | Urgente |
| F | Deterioro completo |
