"""
parse_logbook.py
================
Lee el export de ROTORsoft (.xlsx), filtra los warnings relevantes
para rodamientos y actualiza directamente data/warnings.json.

USO:
  python parsers/parse_logbook.py
  python parsers/parse_logbook.py --archivo ROTORsoft_Abril.xlsx
  python parsers/parse_logbook.py --archivo ROTORsoft_Abril.xlsx --forzar

REQUISITOS:
  pip install openpyxl pandas
"""

import json
import os
import re
import sys
import argparse
import pandas as pd
from datetime import datetime

# ── Rutas ──────────────────────────────────────────────────────────────────────
BASE_DIR       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_INPUT  = os.path.join(BASE_DIR, "ROTORsoft_Logbook.xlsx")
WARNINGS_JSON  = os.path.join(BASE_DIR, "data", "warnings.json")

# ── Códigos relevantes para rodamientos ───────────────────────────────────────
CODIGOS_INCLUIDOS = {
    "58.2":  "Lub. Sin presión",
    "58.5":  "Lub. Sin pres.(aux)",
    "58.1":  "Grasa vacío",
    "50.23": "Ruido Nacelle",
    "50.19": "Sensor acúst.",
    "72.99": "Air Gap",
}

CODIGOS_EXCLUIDOS = {"50.13", "50.18"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def extraer_turbina(planta):
    """'PSP-30 E920293' → 'PSP-30'"""
    if not planta or not isinstance(planta, str):
        return None
    m = re.match(r'(PSP-\d+)', planta.strip())
    return m.group(1) if m else None

def extraer_codigo(original_event):
    """'[58.2] Fault lubrication system...' → '58.2'"""
    if not original_event or not isinstance(original_event, str):
        return None
    m = re.match(r'\[(\d+\.\d+)\]', original_event.strip())
    return m.group(1) if m else None

def formato_mes(periodo):
    """'2026-03' → "Mar'26"  |  '2025-01' → "Ene'25" """
    MESES = {
        '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr',
        '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago',
        '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic',
    }
    año, mes = str(periodo).split('-')
    return f"{MESES[mes]}'{año[2:]}"

# ── Paso 1: Leer y filtrar el ROTORsoft ───────────────────────────────────────

def filtrar_logbook(ruta_archivo):
    print(f"\n[1/3] Leyendo {os.path.basename(ruta_archivo)}...")
    df = pd.read_excel(ruta_archivo, header=1, engine='openpyxl')

    n_cols = len(df.columns)
    nombres_base = [
        'fecha_inicio', 'fecha_inicio2', 'duracion', 'fecha_fin', 'fecha_fin2',
        'planta', 'categoria', 'rs_event', 'original_event', 'perdida_prod',
        'centro_costo', 'potencia_kw', 'viento_ms', 'detalles', 'comentarios'
    ]
    df.columns = nombres_base[:n_cols] + [f'extra_{i}' for i in range(max(0, n_cols - 15))]

    print(f"      Total filas en el archivo: {len(df):,}")

    patron_inc = '|'.join([rf'\[{c}\]' for c in CODIGOS_INCLUIDOS])
    patron_exc = '|'.join([rf'\[{c}\]' for c in CODIGOS_EXCLUIDOS])

    mask = (
        df['original_event'].astype(str).str.contains(patron_inc, na=False, regex=True) &
       ~df['original_event'].astype(str).str.contains(patron_exc, na=False, regex=True)
    )
    df_f = df[mask].copy()
    print(f"      Filas con códigos relevantes: {len(df_f)}")

    if df_f.empty:
        print("  ⚠️  No se encontraron warnings relevantes.")
        print("      Verificá que el archivo tenga datos de Peralta I.")
        return {}, []

    df_f['turbina']   = df_f['planta'].apply(extraer_turbina)
    df_f['codigo']    = df_f['original_event'].apply(extraer_codigo)
    df_f['mes_key']   = pd.to_datetime(df_f['fecha_inicio']).dt.to_period('M').astype(str)
    df_f['mes_label'] = df_f['mes_key'].apply(formato_mes)
    df_f = df_f[df_f['turbina'].notna()]

    meses = sorted(df_f['mes_key'].unique())

    print(f"      Período: {', '.join(formato_mes(m) for m in meses)}")
    print(f"      Turbinas con warnings: {', '.join(sorted(df_f['turbina'].unique()))}")
    print(f"      Desglose por código:")
    for cod, cnt in df_f['codigo'].value_counts().items():
        print(f"        [{cod}] {CODIGOS_INCLUIDOS.get(cod, cod)}: {cnt}")

    nuevo = {}
    for turbina in sorted(df_f['turbina'].unique()):
        df_t = df_f[df_f['turbina'] == turbina]
        nuevo[turbina] = {}
        for mes_key in meses:
            df_m    = df_t[df_t['mes_key'] == mes_key]
            mes_lbl = formato_mes(mes_key)
            por_tipo = {
                nombre: df_m[df_m['codigo'] == cod].shape[0]
                for cod, nombre in CODIGOS_INCLUIDOS.items()
                if df_m[df_m['codigo'] == cod].shape[0] > 0
            }
            nuevo[turbina][mes_lbl] = {
                "total":    len(df_m),
                "por_tipo": por_tipo,
            }

    return nuevo, meses

# ── Paso 2: Detectar cambios y conflictos ─────────────────────────────────────

def detectar_cambios(warnings_existente, nuevo):
    cambios    = []  # (turbina, mes, total) — entradas nuevas
    conflictos = []  # (turbina, mes, val_actual, val_nuevo) — mes ya existe

    for turbina, meses_data in nuevo.items():
        for mes_lbl, data in meses_data.items():
            existente = warnings_existente.get(turbina, {}).get('mensual', {}).get(mes_lbl)
            if existente is not None and existente != 0:
                conflictos.append((turbina, mes_lbl, existente, data['total']))
            else:
                cambios.append((turbina, mes_lbl, data['total']))

    return cambios, conflictos

# ── Paso 3: Fusionar en warnings.json ─────────────────────────────────────────

def fusionar(warnings_existente, nuevo):
    for turbina, meses_data in nuevo.items():
        if turbina not in warnings_existente:
            warnings_existente[turbina] = {
                "cat_tras": "ND",
                "por_tipo": {},
                "mensual":  {},
                "total_warnings": 0,
            }

        entrada = warnings_existente[turbina]

        for mes_lbl, data in meses_data.items():
            entrada.setdefault('mensual', {})[mes_lbl] = data['total']
            for tipo, count in data['por_tipo'].items():
                entrada.setdefault('por_tipo', {})[tipo] = \
                    entrada['por_tipo'].get(tipo, 0) + count

        entrada['total_warnings'] = sum(entrada.get('mensual', {}).values())

    return warnings_existente

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='Actualizar warnings.json desde ROTORsoft')
    ap.add_argument('--archivo', default=DEFAULT_INPUT,
                    help=f'Archivo xlsx de ROTORsoft (default: {DEFAULT_INPUT})')
    ap.add_argument('--forzar', action='store_true',
                    help='Sobreescribir meses que ya existen sin preguntar')
    args = ap.parse_args()

    if not os.path.exists(args.archivo):
        print(f"\nERROR: No se encontró '{args.archivo}'")
        print(f"Uso:   python parsers/parse_logbook.py --archivo NombreDelArchivo.xlsx")
        sys.exit(1)

    if not os.path.exists(WARNINGS_JSON):
        print(f"\nERROR: No se encontró '{WARNINGS_JSON}'")
        print("Primero corré parse_actualizacion.py para generar el JSON base.")
        sys.exit(1)

    # Paso 1 — filtrar logbook
    nuevo, meses = filtrar_logbook(args.archivo)
    if not nuevo:
        sys.exit(0)

    # Paso 2 — cargar existente y detectar cambios
    print(f"\n[2/3] Leyendo {WARNINGS_JSON}...")
    with open(WARNINGS_JSON, 'r', encoding='utf-8') as f:
        warnings_existente = json.load(f)
    print(f"      {len(warnings_existente)} turbinas cargadas.")

    cambios, conflictos = detectar_cambios(warnings_existente, nuevo)

    print(f"\n{'─'*57}")
    print(f"  RESUMEN DE CAMBIOS")
    print(f"{'─'*57}")

    if cambios:
        print(f"\n  Entradas nuevas ({len(cambios)}):")
        for turbina, mes, total in sorted(cambios):
            por_tipo = nuevo[turbina][mes]['por_tipo']
            detalle  = ', '.join(f"{n}: {v}" for n, v in por_tipo.items())
            print(f"    {turbina}  {mes}  →  total: {total}  ({detalle})")

    if conflictos:
        print(f"\n  ⚠️  Conflictos — mes ya existe ({len(conflictos)}):")
        for turbina, mes, actual, nuevo_val in sorted(conflictos):
            print(f"    {turbina}  {mes}  →  actual: {actual}  nuevo: {nuevo_val}")
        if not args.forzar:
            print(f"\n  Estos se ignorarán. Usá --forzar para sobreescribirlos.")

    if not cambios and not (conflictos and args.forzar):
        print("\n  No hay nada nuevo para agregar.")
        sys.exit(0)

    print(f"{'─'*57}")

    # Confirmación
    n_aplicar = len(cambios) + (len(conflictos) if args.forzar else 0)
    resp = input(f"\n  ¿Aplicar {n_aplicar} cambios en warnings.json? (s/n): ").strip().lower()

    if resp != 's':
        print("\n  Cancelado. No se modificó nada.")
        sys.exit(0)

    # Si no se fuerza, quitar conflictos del dict a fusionar
    if not args.forzar:
        for turbina, mes, _, _ in conflictos:
            if turbina in nuevo and mes in nuevo[turbina]:
                del nuevo[turbina][mes]
        nuevo = {t: m for t, m in nuevo.items() if m}

    # Paso 3 — fusionar y guardar
    print(f"\n[3/3] Actualizando {WARNINGS_JSON}...")
    warnings_actualizado = fusionar(warnings_existente, nuevo)

    with open(WARNINGS_JSON, 'w', encoding='utf-8') as f:
        json.dump(warnings_actualizado, f, ensure_ascii=False, indent=2)

    print(f"      ✓ {WARNINGS_JSON} actualizado.")
    print(f"\n{'─'*57}")
    print(f"  LISTO. Subí data/warnings.json al servidor y el")
    print(f"  dashboard mostrará los datos nuevos automáticamente.")
    print(f"{'─'*57}\n")

if __name__ == "__main__":
    main()
