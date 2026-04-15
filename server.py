"""
server.py — Peralta I · Monitor de Rodamientos
===============================================
Servidor Flask que:
  - Sirve el dashboard (index.html, app.js, style.css, data/)
  - Gestiona login con dos roles: admin y cliente
  - Permite al admin subir los Excel y regenerar los JSON automáticamente
"""

import os
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
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-cambiar-en-produccion')

# Credenciales — se definen como variables de entorno en Railway
ADMIN_USER   = os.environ.get('ADMIN_USER',   'admin')
ADMIN_PASS   = os.environ.get('ADMIN_PASS',   'admin123')
CLIENT_USER  = os.environ.get('CLIENT_USER',  'cliente')
CLIENT_PASS  = os.environ.get('CLIENT_PASS',  'cliente123')

# Ruta raíz del proyecto (donde vive server.py)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')

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
