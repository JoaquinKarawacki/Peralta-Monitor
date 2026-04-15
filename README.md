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
└── parsers/        
    ├── parse_actualizacion.py
    ├── parse_historico.py
    └── parse_logbook.py
```


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
