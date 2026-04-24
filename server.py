"""
server.py — Peralta I · Monitor de Rodamientos
===============================================
Servidor Flask que:
  - Sirve el dashboard (index.html, app.js, style.css, data/)
  - Gestiona login con dos roles: admin y cliente
  - Permite al admin subir los Excel y regenerar los JSON automáticamente
"""

import os
import shutil
import subprocess
import sys
from datetime import datetime
from functools import wraps

from flask import (
    Flask, render_template, request, redirect,
    url_for, session, send_from_directory, jsonify
)

# ── Configuración ──────────────────────────────────────────────────────────────

app = Flask(__name__)

# SECRET_KEY: firma las cookies de sesión. En Railway se define como variable
# de entorno. El valor por defecto solo sirve para desarrollo local.
app.secret_key = os.environ.get('SECRET_KEY', 'aqwertyuiopasdfghjlzxcvbnmm')

# Credenciales — se definen como variables de entorno en Railway
ADMIN_USER   = os.environ.get('ADMIN_USER',   'admin')
ADMIN_PASS   = os.environ.get('ADMIN_PASS',   'admin123')
CLIENT_USER  = os.environ.get('CLIENT_USER',  'peralta')
CLIENT_PASS  = os.environ.get('CLIENT_PASS',  'peralta123')

# Ruta raíz del proyecto (donde vive server.py)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
SEED_DIR = os.path.join(BASE_DIR, 'data_seed')

def init_data():
    
    os.makedirs(DATA_DIR, exist_ok=True)
    seed_files = ['estado_actual.json', 'warnings.json', 'historico_rodamientos.json']
    for fname in seed_files:
        dest = os.path.join(DATA_DIR, fname)
        seed = os.path.join(SEED_DIR, fname)
        if not os.path.exists(dest) and os.path.exists(seed):
            shutil.copy2(seed, dest)

init_data()

# ── Decoradores de autenticación ───────────────────────────────────────────────

def login_required(f):
    """Redirige al login si el usuario no está autenticado."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    """Redirige al dashboard si el usuario no es admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login'))
        if session.get('role') != 'admin':
            return redirect(url_for('index'))
        return f(*args, **kwargs)
    return decorated

# ── Rutas de autenticación ─────────────────────────────────────────────────────

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        user = request.form.get('username', '').strip()
        pwd  = request.form.get('password', '').strip()

        if user == ADMIN_USER and pwd == ADMIN_PASS:
            session['user'] = user
            session['role'] = 'admin'
            return redirect(url_for('index'))
        elif user == CLIENT_USER and pwd == CLIENT_PASS:
            session['user'] = user
            session['role'] = 'client'
            return redirect(url_for('index'))
        else:
            error = 'Usuario o contraseña incorrectos'

    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# ── Dashboard principal ────────────────────────────────────────────────────────

@app.route('/')
@login_required
def index():
    return render_template('index.html', role=session.get('role'))

# ── Panel de admin ─────────────────────────────────────────────────────────────

@app.route('/admin')
@admin_required
def admin():
    # Fecha del último update (basada en la fecha de modificación del JSON)
    last_update = None
    estado_path = os.path.join(DATA_DIR, 'estado_actual.json')
    if os.path.exists(estado_path):
        mtime = os.path.getmtime(estado_path)
        last_update = datetime.fromtimestamp(mtime).strftime('%d/%m/%Y — %H:%Mhs')

    return render_template('admin.html', last_update=last_update)


@app.route('/upload', methods=['POST'])
@admin_required
def upload():
    """
    Recibe los Excel subidos por el admin, los guarda con nombre fijo
    y corre los parsers correspondientes.
    """
    monitoreo_file = request.files.get('monitoreo')
    logbook_file   = request.files.get('logbook')

    updated = []
    errors  = []

    # ── Procesar Peralta I Actualización ──
    if monitoreo_file and monitoreo_file.filename:
        # Guardamos siempre con el mismo nombre, sin importar el original
        dest = os.path.join(BASE_DIR, 'Peralta_I_Actualizacion_Rodamientos.xlsx')
        monitoreo_file.save(dest)

        result = subprocess.run(
            [sys.executable, os.path.join(BASE_DIR, 'parsers', 'parse_actualizacion.py')],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            updated.append('Peralta I Actualización')
        else:
            errors.append(f'Error en Actualización: {result.stderr.strip()}')

    # ── Procesar Logbook ROTORsoft ──
    if logbook_file and logbook_file.filename:
        # Guardamos siempre con el mismo nombre, sin importar el original
        dest = os.path.join(BASE_DIR, 'ROTORsoft_Logbook.xlsx')
        logbook_file.save(dest)

        result = subprocess.run(
            [sys.executable, os.path.join(BASE_DIR, 'parsers', 'parse_logbook.py')],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            updated.append('Logbook ROTORsoft')
        else:
            errors.append(f'Error en Logbook: {result.stderr.strip()}')

    return jsonify({
        'success': len(errors) == 0 and len(updated) > 0,
        'updated': updated,
        'errors':  errors
    })

# ── Descarga de HTML auto-contenido ───────────────────────────────────────────

@app.route('/download-html')
@admin_required
def download_html():
    """Genera el dashboard como un HTML auto-contenido para compartir con el cliente."""
    import json as _json

    with open(os.path.join(BASE_DIR, 'static', 'style.css'), encoding='utf-8') as f:
        css = f.read()
    with open(os.path.join(BASE_DIR, 'static', 'app.js'), encoding='utf-8') as f:
        js = f.read()

    def read_json(name):
        path = os.path.join(DATA_DIR, name)
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                return _json.load(f)
        return {}

    estado_data    = read_json('estado_actual.json')
    warnings_data  = read_json('warnings.json')
    historico_data = read_json('historico_rodamientos.json')

    generated = datetime.now().strftime('%d/%m/%Y %H:%Mhs')
    filename  = f"Peralta_I_Rodamientos_{datetime.now().strftime('%Y%m%d')}.html"

    html_content = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Peralta I — Rodamientos</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <style>
{css}
  </style>
</head>
<body>

  <nav>
    <div class="nav-logo">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" class="logo-spin" style="transform-origin:50% 50%">
        <line x1="9" y1="9" x2="9"    y2="2"    stroke="#4da6ff" stroke-width="1.6" stroke-linecap="round"/>
        <line x1="9" y1="9" x2="15.5" y2="13"   stroke="#4da6ff" stroke-width="1.6" stroke-linecap="round"/>
        <line x1="9" y1="9" x2="2.5"  y2="13"   stroke="#4da6ff" stroke-width="1.6" stroke-linecap="round"/>
        <circle cx="9" cy="9" r="2" fill="#4da6ff"/>
        <circle cx="9" cy="9" r="1" fill="#07101a"/>
      </svg>
      <span class="nav-brand">Peralta I &mdash; Rodamientos</span>
    </div>

    <nav class="nav-tabs">
      <button class="tab active" data-page="resumen">Resumen</button>
      <button class="tab"        data-page="mapa">Mapa Estado</button>
      <button class="tab"        data-page="turbina">Por Turbina</button>
    </nav>

    <div class="nav-actions">
      <span style="font-family:var(--font-mono);font-size:.5rem;color:var(--t3)">Generado: {generated}</span>
    </div>
  </nav>

  <main>
    <div id="page-resumen"  class="page active"></div>
    <div id="page-mapa"     class="page"></div>
    <div id="page-turbina"  class="page"></div>
  </main>

  <div id="loading">
    <div class="loading-inner">
      <svg width="24" height="24" viewBox="0 0 18 18" fill="none" class="logo-spin">
        <line x1="9" y1="9" x2="9"    y2="2"    stroke="#4da6ff" stroke-width="1.6" stroke-linecap="round"/>
        <line x1="9" y1="9" x2="15.5" y2="13"   stroke="#4da6ff" stroke-width="1.6" stroke-linecap="round"/>
        <line x1="9" y1="9" x2="2.5"  y2="13"   stroke="#4da6ff" stroke-width="1.6" stroke-linecap="round"/>
        <circle cx="9" cy="9" r="2" fill="#4da6ff"/>
        <circle cx="9" cy="9" r="1" fill="#07101a"/>
      </svg>
      <span>Cargando datos...</span>
    </div>
  </div>

  <script>
    window.__STATIC_DATA__ = {{
      estado:    {_json.dumps(estado_data,    ensure_ascii=False)},
      warnings:  {_json.dumps(warnings_data,  ensure_ascii=False)},
      historico: {_json.dumps(historico_data, ensure_ascii=False)}
    }};
  </script>

  <script>
{js}
  </script>

</body>
</html>"""

    from flask import Response
    return Response(
        html_content,
        mimetype='text/html',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'}
    )

# ── JSON de datos (fetch desde app.js) ────────────────────────────────────────

@app.route('/data/<filename>')
@login_required
def serve_data(filename):
    """Sirve los JSON generados por los parsers."""
    return send_from_directory(DATA_DIR, filename)

# ── Arranque local ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
