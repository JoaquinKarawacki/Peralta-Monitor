"""
parse_historico.py
==================
Lee Monitoreo_de_Rodamientos_JG_1.xlsx y genera:
  - data/historico_rodamientos.json  → historial completo de cada turbina

USO:
  python parsers/parse_historico.py

REQUISITOS:
  pip install openpyxl
"""

import json
import os
from datetime import datetime
import openpyxl

# ── Rutas ──────────────────────────────────────────────────────────────────────
INPUT_FILE = "../Monitoreo de Rodamientos JG 1.xlsx"
OUTPUT_DIR = "data"

# ── Helpers ───────────────────────────────────────────────────────────────────

def fmt_fecha(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    return s if s else None

def limpiar(val):
    if val is None:
        return None
    if isinstance(val, str):
        return val.strip() or None
    return val

# ── Parser hoja PERALTA ───────────────────────────────────────────────────────

def parsear_historico(ws):
    """
    Estructura de la hoja (filas 10-11 = cabecera doble, datos desde fila 12):

    col 0  Nº de WEC
    col 1  Cambio de Rodamiento Frontal (fecha)
    col 2  Cambio de Rodamiento Trasero (fecha)
    col 3  Tiempo de parada retrofit (días)
    col 4  Inspección Joao Alvez (X = sí)
    col 5  Fecha inspección Joao Alvez
    col 6  Comentario inspección Joao Alvez
    col 7  Mant. Master 2025 - Fecha
    col 8  Mant. Master 2025 - Cat Rod Del
    col 9  Mant. Master 2025 - Cat Rod Tras
    col 10 Mant. 2026 - Fecha
    col 11 Mant. 2026 - Tipo
    col 12 Mant. 2026 - Cat Rod Del
    col 13 Mant. 2026 - Cat Rod Tras
    col 14 Comentarios generales
    col 15 Plan de acción Enercon

    Nota: los WEC vienen como WEC01..WEC50, se normalizan a PSP-01..PSP-50
    """
    resultado = {}

    for row in ws.iter_rows(min_row=12, values_only=True):
        wec_raw = limpiar(row[0])
        if not wec_raw:
            continue

        # Normalizar WEC01 → PSP-01
        wec = normalizar_wec(wec_raw)

        # Construir lista de medidas históricas ordenadas por fecha
        medidas = []

        # Mant. Master 2025
        if row[7]:
            medidas.append({
                "fecha":    fmt_fecha(row[7]),
                "tipo":     "Mant. Master 2025",
                "cat_del":  limpiar(row[8]),
                "cat_tras": limpiar(row[9]),
            })

        # Mant. 2026
        if row[10]:
            medidas.append({
                "fecha":    fmt_fecha(row[10]),
                "tipo":     limpiar(row[11]) or "Mant. 2026",
                "cat_del":  limpiar(row[12]),
                "cat_tras": limpiar(row[13]),
            })

        # Ordenar por fecha ascendente
        medidas.sort(key=lambda m: m["fecha"] or "")

        resultado[wec] = {
            "cambio_frontal":        fmt_fecha(row[1]),
            "cambio_trasero":        fmt_fecha(row[2]),
            "parada_retrofit_dias":  limpiar(row[3]),

            # Inspección técnico Joao Alvez
            "insp_joao": {
                "realizada":    limpiar(row[4]) == "X" or limpiar(row[4]) == "x",
                "fecha":        fmt_fecha(row[5]),
                "comentario":   limpiar(row[6]),
            },

            # Historial de medidas
            "medidas": medidas,

            # Info extra
            "comentarios":          limpiar(row[14]),
            "plan_accion_enercon":  limpiar(row[15]),
        }

    return resultado


def normalizar_wec(wec_raw):
    """
    Convierte 'WEC01' → 'PSP-01', 'WEC10' → 'PSP-10', etc.
    Si ya tiene el formato PSP-XX lo devuelve igual.
    """
    s = str(wec_raw).strip().upper()
    if s.startswith("WEC"):
        num = s.replace("WEC", "").lstrip("0") or "0"
        return f"PSP-{int(num):02d}"
    return wec_raw


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not os.path.exists(INPUT_FILE):
        print(f"ERROR: No se encontró '{INPUT_FILE}'")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Leyendo {INPUT_FILE}...")
    wb = openpyxl.load_workbook(INPUT_FILE, read_only=True, data_only=True)

    ws = wb["PERALTA"]
    historico = parsear_historico(ws)

    out_path = os.path.join(OUTPUT_DIR, "historico_rodamientos.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(historico, f, ensure_ascii=False, indent=2)

    wb.close()

    print(f"  ✓ {out_path}  ({len(historico)} turbinas)")
    print("\nListo. El JSON está en la carpeta 'data/'.")


if __name__ == "__main__":
    main()
