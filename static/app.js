/**
 * app.js — Peralta I · Monitor de Rodamientos
 *
 * Flujo:
 *  1. loadData()       → fetch de los tres JSON en paralelo
 *  2. buildResumen()   → tab "Resumen"
 *  3. buildMapa()      → tab "Mapa Estado" (lazy: se arma la primera vez que se abre)
 *  4. buildTurbina()   → tab "Por Turbina" (lazy)
 *
 * Los JSON viven en ./data/ y son generados por los scripts Python del paso 1.
 */

'use strict';

/* ── Constantes de configuración ──────────────────────────────────────────── */

// Los meses se derivan dinámicamente de warnings.json después de cargar datos.
// Se inicializan vacíos y se pueblan en derivarMeses().
let MESES_KEYS   = [];   // ["Ene'25", "Feb'25", ..., "Mar'26", "Abr'26", ...]
let MESES_LABELS = [];   // igual que MESES_KEYS (en este dashboard son el mismo valor)

const CAT_COLORS = {
  A: '#3dffa0', B: '#ffcc00', C: '#ff8c00',
  D: '#ff4d4d', E: '#cc0000', F: '#880000', ND: '#3d5f80'
};

const CAT_LABELS = {
  A: 'OK', B: 'Seguimiento', C: 'Seguimiento prioritario',
  D: 'Planif. cambio', E: 'Urgente', F: 'Deterioro completo', ND: 'No determinado'
};

// Colores y nombres cortos por subtipo de warning
const SUBTIPO_COLORES = {
  'Lub. Sin presión':     '#e8922e',
  'Lub. Sin pres.(aux)':  '#c4750f',
  'Grasa vacío':          '#d4660a',
  'Ruido Nacelle':        '#38b0f8',
  'Sensor acúst.':        '#4878a8',
  'Air Gap':              '#d64ebe',
};

// Orden canónico de turbinas
const TURBINAS = Array.from({ length: 50 }, (_, i) => `PSP-${String(i + 1).padStart(2, '0')}`);

/* ── Estado de la app ─────────────────────────────────────────────────────── */

let estado    = {};   // estado_actual.json
let warnings  = {};   // warnings.json
let historico = {};   // historico_rodamientos.json

let mapaBuilt    = false;
let turbinaBuilt = false;
let turbinaSeleccionada = TURBINAS[0];
let turbinaFiltro = 'all';

/* ── Helpers HTML ─────────────────────────────────────────────────────────── */

/**
 * Devuelve un <span> con el badge de categoría coloreado.
 * Si no hay categoría o es ND, devuelve un guión.
 */
function catBadge(cat, small = false) {
  if (!cat || cat === 'ND') return '—';
  const color = CAT_COLORS[cat] || '#3d5f80';
  const cls   = small ? 'cat-badge small' : 'cat-badge';
  return `<span class="${cls}" style="background:${color}22;border:1px solid ${color}55;color:${color}">${cat}</span>`;
}

/**
 * Suma todos los elementos de un array numérico.
 */
function sumArray(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((acc, v) => acc + (v || 0), 0);
}

/**
 * Convierte una fecha 'YYYY-MM-DD' al label de mes ("Ene'25", etc.)
 * usando el mismo formato que usa parse_logbook.py.
 */
function fechaAMesLabel(fecha) {
  if (!fecha) return null;
  const MESES_NOMBRES = {
    '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr',
    '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago',
    '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic',
  };
  const año = fecha.slice(2, 4);
  const mes = fecha.slice(5, 7);
  return `${MESES_NOMBRES[mes]}'${año}`;
}

/**
 * Devuelve el índice de un mes dentro de MESES_KEYS a partir de una fecha 'YYYY-MM-DD'.
 * Si la fecha no existe en el rango actual, devuelve -1.
 */
function mesIndex(fecha) {
  if (!fecha) return -1;
  const label = fechaAMesLabel(fecha);
  return MESES_KEYS.indexOf(label);
}

/**
 * Deriva MESES_KEYS y MESES_LABELS de forma dinámica leyendo
 * las claves 'mensual' de todas las turbinas en warnings.json.
 * Los ordena cronológicamente para que nuevos meses aparezcan solos.
 */
function derivarMeses() {
  const ORDEN_MES = { 'Ene':1,'Feb':2,'Mar':3,'Abr':4,'May':5,'Jun':6,
                      'Jul':7,'Ago':8,'Sep':9,'Oct':10,'Nov':11,'Dic':12 };

  const conjunto = new Set();
  Object.values(warnings).forEach(turbina => {
    Object.keys(turbina.mensual || {}).forEach(m => conjunto.add(m));
  });

  // Ordenar: primero por año, luego por mes
  const ordenados = [...conjunto].sort((a, b) => {
    // formato: "Ene'25" → año=25, mes=1
    const [nA, yA] = [a.slice(0, 3), parseInt(a.slice(4))];
    const [nB, yB] = [b.slice(0, 3), parseInt(b.slice(4))];
    if (yA !== yB) return yA - yB;
    return ORDEN_MES[nA] - ORDEN_MES[nB];
  });

  MESES_KEYS   = ordenados;
  MESES_LABELS = ordenados;
}

/* ── Carga de datos ───────────────────────────────────────────────────────── */

async function loadData() {
  try {
    if (window.__STATIC_DATA__) {
      ({ estado, warnings, historico } = window.__STATIC_DATA__);
      derivarMeses();
      return;
    }

    const [resEstado, resWarnings, resHistorico] = await Promise.all([
      fetch('data/estado_actual.json'),
      fetch('data/warnings.json'),
      fetch('data/historico_rodamientos.json'),
    ]);

    if (!resEstado.ok || !resWarnings.ok || !resHistorico.ok) {
      throw new Error('Error al cargar uno o más archivos JSON.');
    }

    estado    = await resEstado.json();
    warnings  = await resWarnings.json();
    historico = await resHistorico.json();

    derivarMeses();

  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<div class="loading-inner" style="color:#ff4d4d">
        Error: ${err.message}<br>
        <small style="color:var(--t3)">Verificá que el servidor esté corriendo y los JSON existan en /data/</small>
      </div>`;
    throw err;
  }
}

/* ── Navegación entre tabs ────────────────────────────────────────────────── */

function goToPage(pageId) {
  // Actualizar páginas
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `page-${pageId}`);
  });

  // Actualizar tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageId);
  });

  // Construcción lazy de secciones pesadas
  if (pageId === 'mapa' && !mapaBuilt) {
    buildMapa();
    mapaBuilt = true;
  }
  if (pageId === 'turbina' && !turbinaBuilt) {
    buildTurbina();
    turbinaBuilt = true;
  }
}

/** Navega a "Por Turbina" y selecciona directamente una turbina. */
function goToTurbina(id) {
  goToPage('turbina');
  setTimeout(() => {
    seleccionarTurbina(id);
    renderDetalleTurbina(id);
  }, 60);
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESUMEN
   ═══════════════════════════════════════════════════════════════════════════ */

function buildResumen() {
  const el = document.getElementById('page-resumen');
  let html  = '';

  html += buildResumenEstadoActual();
  html += buildResumenCriticas();

  el.innerHTML = html;
}

/* ── Barras de estado actual (Del / Tras) ──────────────────────────────── */

function buildResumenEstadoActual() {
  const cats   = ['A', 'B', 'C', 'D'];
  const campos = ['cat_del', 'cat_tras'];
  const labels = ['Rodamiento Delantero', 'Rodamiento Trasero'];

  let html = `<div class="section-label">● Estado actual — Última medición</div><div class="grid-2">`;

  campos.forEach((campo, i) => {
    const counts = cats.map(c =>
      TURBINAS.filter(id => estado[id]?.[campo] === c).length
    );
    const maxVal = Math.max(...counts) || 1;

    html += `<div class="card">
      <div class="card-header">${labels[i]}</div>
      <div class="card-body" style="padding-top:16px;padding-bottom:8px">
        <div style="display:flex;align-items:flex-end;gap:20px;height:160px;justify-content:center">`;

    cats.forEach((cat, ci) => {
      const color  = CAT_COLORS[cat];
      const v      = counts[ci];
      const barH   = Math.max(v > 0 ? 8 : 0, Math.round(v / maxVal * 100));

      html += `<div style="text-align:center;min-width:44px">
        <div style="font-family:var(--font-mono);font-size:1rem;font-weight:700;color:${color}">${v}</div>
        <div style="width:38px;height:${barH}px;background:${color};border-radius:3px 3px 0 0;margin:3px auto"></div>
        ${catBadge(cat)}
        <div style="font-size:.46rem;color:var(--t3);font-family:var(--font-mono);margin-top:3px">${CAT_LABELS[cat]}</div>
      </div>`;
    });

    html += `</div></div></div>`;
  });

  return html + '</div>';
}

/* ── Turbinas críticas (cat ≠ A) con warnings últimos 3 meses ─────────── */

function buildResumenCriticas() {
  // Filtrar turbinas con cat_tras distinta de A
  const criticas = TURBINAS
    .filter(id => estado[id] && estado[id].cat_tras !== 'A')
    .sort((a, b) => {
      const orden = { D: 0, C: 1, B: 2 };
      const dif   = (orden[estado[a].cat_tras] ?? 9) - (orden[estado[b].cat_tras] ?? 9);
      if (dif !== 0) return dif;
      return totalWarnings(b) - totalWarnings(a);
    });

  if (!criticas.length) {
    return `<div class="section-label">● Rodamientos con categoría ≠ A</div>
            <div style="font-family:var(--font-mono);font-size:.6rem;color:var(--t3);padding:12px 0">
              Todas las turbinas en categoría A ✓
            </div>`;
  }

  // Últimos 3 meses del período disponible (dinámico)
  const ultimos3 = MESES_KEYS.slice(-3);
  const ultimos3Idx = ultimos3.map(m => MESES_KEYS.indexOf(m));

  // Escala global para los últimos 3 meses
  const maxMes = Math.max(
    ...criticas.flatMap(id => ultimos3.map(m => getWarningMes(id, MESES_KEYS.indexOf(m))))
  ) || 1;
  const BAR_MAX_H = 80;

  let html = `
    <div class="section-label">● Rodamientos con categoría ≠ A — Warnings últimos 3 meses</div>
    <div class="card">
      <div class="card-header">${ultimos3.join(', ')} — desglose por tipo de warning</div>
      <div class="card-body">
        <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:4px;align-items:flex-end">`;

  criticas.forEach(id => {
    html += `<div style="min-width:58px;cursor:pointer" onclick="goToTurbina('${id}')">`;

    // 3 barras apiladas por mes
    html += `<div style="display:flex;gap:2px;align-items:flex-end;height:${BAR_MAX_H}px;justify-content:center">`;
    ultimos3Idx.forEach(mi => {
      const v   = getWarningMes(id, mi);
      const bH  = Math.max(v > 0 ? 3 : 0, Math.round(v / maxMes * BAR_MAX_H));
      const segs = buildStackedSegments(id, mi, v, bH);
      html += `<div style="width:16px;display:flex;flex-direction:column-reverse;
                  border-radius:2px 2px 0 0;overflow:hidden;
                  background:${v > 0 ? 'transparent' : 'var(--b1)'};min-height:1px">
                ${segs}
               </div>`;
    });
    html += `</div>`;

    // Números debajo de cada barra
    html += `<div style="display:flex;gap:2px;justify-content:center;margin-top:2px">`;
    ultimos3Idx.forEach(mi => {
      const v = getWarningMes(id, mi);
      html += `<div style="width:14px;text-align:center;font-family:var(--font-mono);
                  font-size:.36rem;color:${v > 0 ? 'var(--t2)' : 'var(--t3)'}">${v}</div>`;
    });
    html += `</div>`;

    // Nombre turbina + badge
    html += `<div style="text-align:center;margin-top:3px">
      <div style="font-family:var(--font-mono);font-size:.52rem;font-weight:700;color:var(--ac)">
        ${id.replace('PSP-', '')}
      </div>
      ${catBadge(estado[id].cat_tras, true)}
    </div>`;

    html += `</div>`;
  });

  html += `</div>`;

  // Leyenda de meses
  html += `<div style="display:flex;gap:8px;margin-top:6px;padding-top:5px;
              border-top:1px solid var(--b1);font-family:var(--font-mono);
              font-size:.44rem;color:var(--t3)">
    <span>Cada grupo:</span>
    ${ultimos3.map(m =>
      `<span style="display:inline-flex;align-items:center;gap:2px">
        <span style="width:8px;height:8px;border-radius:2px;
              background:var(--b2);display:inline-block"></span>
        ${m}
      </span>`
    ).join('')}
  </div>`;

  // Leyenda subtipos
  html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;padding-top:5px;
              border-top:1px solid var(--b1);font-size:.44rem;
              font-family:var(--font-mono);color:var(--t2)">`;
  Object.entries(SUBTIPO_COLORES).forEach(([nombre, color]) => {
    html += `<span>
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;
            background:${color};margin-right:3px;vertical-align:middle"></span>
      ${nombre}
    </span>`;
  });
  html += `</div></div></div>`;

  return html;
}

/* ── Helpers para warnings ─────────────────────────────────────────────── */

/**
 * Devuelve el total de warnings de una turbina para un mes dado (por índice).
 * Usa los datos de warnings.json (campo "mensual").
 */
function getWarningMes(id, mesIndex) {
  const w = warnings[id];
  if (!w) return 0;
  const clave = MESES_KEYS[mesIndex];
  return w.mensual?.[clave] || 0;
}

/**
 * Total de warnings de una turbina en todo el período.
 */
function totalWarnings(id) {
  const w = warnings[id];
  if (!w) return 0;
  return Object.values(w.mensual || {}).reduce((a, v) => a + (v || 0), 0);
}

/**
 * Construye los segmentos apilados de una barra mensual coloreados por subtipo.
 */
function buildStackedSegments(id, mesIndex, totalMes, barH) {
  if (totalMes === 0) return '';
  const w = warnings[id];
  if (!w?.por_tipo) return '';

  const claveMes = MESES_KEYS[mesIndex];
  let segs = '';

  // Mapeo nombre_corto → valor en ese mes
  // Nota: en warnings.json los subtipos usan el nombre corto del Excel
  Object.entries(SUBTIPO_COLORES).forEach(([nombre, color]) => {
    // Intentamos obtener el valor de ese subtipo en ese mes
    // (warnings.json tiene totales; para desglose mensual usamos la proporción)
    const totalTipo = w.por_tipo?.[nombre] || 0;
    const totalGen  = totalWarnings(id) || 1;
    const mesTipo   = Math.round((totalTipo / totalGen) * totalMes);

    if (mesTipo > 0) {
      const segH = Math.max(1, Math.round(mesTipo / totalMes * barH));
      segs += `<div style="width:100%;height:${segH}px;background:${color}" title="${nombre}: ~${mesTipo}"></div>`;
    }
  });

  return segs;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAPA
   ═══════════════════════════════════════════════════════════════════════════ */

let mapaSeleccionada = null;

function buildMapa() {
  const el = document.getElementById('page-mapa');

  let html = `<div class="section-label">● Mapa de estado — Click para ver detalle</div>
              <div class="turbine-grid">`;

  TURBINAS.forEach(id => {
    const est = estado[id] || {};
    html += `
      <div class="turbine-cell" data-id="${id}" onclick="toggleMapa('${id}')">
        <div style="font-family:var(--font-mono);font-size:.64rem;font-weight:700;
                    color:var(--t1);margin-bottom:3px">
          ${id.replace('PSP-', '')}
        </div>
        <div style="display:flex;justify-content:center;gap:2px">
          ${catBadge(est.cat_del, true)} ${catBadge(est.cat_tras, true)}
        </div>
      </div>`;
  });

  html += `</div><div id="mapa-detalle"></div>`;
  el.innerHTML = html;
}

function toggleMapa(id) {
  mapaSeleccionada = mapaSeleccionada === id ? null : id;

  // Actualizar estilos de celdas
  document.querySelectorAll('.turbine-cell').forEach(cell => {
    const cellId  = cell.dataset.id;
    const cat     = estado[cellId]?.cat_tras;
    const color   = CAT_COLORS[cat] || '#3d5f80';
    const activa  = cellId === mapaSeleccionada;

    cell.classList.toggle('selected', activa);
    cell.style.borderColor = activa ? color : '';
    cell.style.boxShadow   = activa ? `0 0 8px ${color}33` : '';
  });

  document.getElementById('mapa-detalle').innerHTML =
    mapaSeleccionada ? buildPanelDetalle(mapaSeleccionada, true) : '';
}

/* ═══════════════════════════════════════════════════════════════════════════
   POR TURBINA
   ═══════════════════════════════════════════════════════════════════════════ */

function buildTurbina() {
  const el = document.getElementById('page-turbina');

  let html = `<div class="turbina-layout">`;

  // ── Sidebar ───────────────────────────────────────────────────────────
  html += `<div class="turbina-sidebar">
    <div class="sidebar-search">
      <input id="turbina-search" type="text" placeholder="Buscar..." autocomplete="off" />
    </div>
    <div class="sidebar-filters">`;

  [['all', 'Todas'], ['D', 'Cat D'], ['C', 'Cat C'], ['B', 'Cat B']].forEach(([val, label]) => {
    html += `<button class="filter-btn ${val === 'all' ? 'active' : ''}"
                     data-filtro="${val}">${label}</button>`;
  });

  html += `</div><div class="turbina-list" id="turbina-list">`;

  TURBINAS.forEach(id => {
    const cat   = estado[id]?.cat_tras || 'ND';
    const color = CAT_COLORS[cat] || '#3d5f80';
    const total = totalWarnings(id);
    const activa = id === turbinaSeleccionada;

    html += `<div class="turbina-item ${activa ? 'selected' : ''}"
                  data-id="${id}" data-cat="${cat}">
      <div class="turbina-item-dot"  style="background:${color}"></div>
      <div class="turbina-item-name">${id}</div>
      <div class="turbina-item-total">${total}</div>
    </div>`;
  });

  html += `</div></div>`;

  // ── Panel de detalle ──────────────────────────────────────────────────
  html += `<div id="turbina-detalle"></div>`;
  html += `</div>`; // turbina-layout

  el.innerHTML = html;

  // Eventos
  document.getElementById('turbina-search')
    .addEventListener('input', filtrarListaTurbinas);

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      turbinaFiltro = btn.dataset.filtro;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filtrarListaTurbinas();
    });
  });

  document.querySelectorAll('.turbina-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      seleccionarTurbina(id);
      renderDetalleTurbina(id);
    });
  });

  // Renderizar la turbina inicial
  renderDetalleTurbina(turbinaSeleccionada);
}

function filtrarListaTurbinas() {
  const query = document.getElementById('turbina-search').value.toLowerCase();

  document.querySelectorAll('.turbina-item').forEach(item => {
    const matchNombre = item.dataset.id.toLowerCase().includes(query);
    const matchFiltro = turbinaFiltro === 'all' || item.dataset.cat === turbinaFiltro;
    item.classList.toggle('hidden', !(matchNombre && matchFiltro));
  });
}

function seleccionarTurbina(id) {
  turbinaSeleccionada = id;
  document.querySelectorAll('.turbina-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.id === id);
  });
  // Scroll al item
  const el = document.querySelector(`.turbina-item[data-id="${id}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function renderDetalleTurbina(id) {
  turbinaSeleccionada = id;
  seleccionarTurbina(id);

  const container = document.getElementById('turbina-detalle');
  if (!container) return;

  let html = buildPanelDetalle(id, false);

  // Si tiene cambio de rodamiento trasero, agregar card de impacto
  const hist = historico[id];
  if (hist?.cambio_trasero) {
    html += buildImpactoCambio(id);
  }

  container.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PANEL DE DETALLE (compartido por Mapa y Por Turbina)
   ═══════════════════════════════════════════════════════════════════════════ */

function buildPanelDetalle(id, conBotonCerrar) {
  const est  = estado[id]    || {};
  const warn = warnings[id]  || {};
  const hist = historico[id] || {};

  const totalLub   = (warn.por_tipo?.['Lub. Sin presión'] || 0) + (warn.por_tipo?.['Lub. Sin pres.(aux)'] || 0);
  const totalAcust = warn.por_tipo?.['Sensor acúst.'] || 0;
  const totalGap   = warn.por_tipo?.['Air Gap'] || 0;
  const total      = totalWarnings(id);

  // ── Header ────────────────────────────────────────────────────────────
  let html = `<div class="detail-panel">
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;
                border-bottom:1px solid var(--b1);flex-wrap:wrap">
      <span style="font-family:var(--font-mono);font-size:1.2rem;font-weight:700;color:var(--ac)">${id}</span>
      <span style="font-family:var(--font-mono);font-size:.85rem;font-weight:600;color:#fff">
        ${total}
        <span style="font-size:.46rem;color:var(--t3);text-transform:uppercase">warnings</span>
      </span>
      ${catBadge(est.cat_tras)}`;

  if (totalLub)   html += ` <span class="cat-badge small" style="background:#e8922e1f;border:1px solid #e8922e4d;color:#e8922e">Lub ${totalLub}</span>`;
  if (totalAcust) html += ` <span class="cat-badge small" style="background:#38b0f81f;border:1px solid #38b0f84d;color:#38b0f8">Acús ${totalAcust}</span>`;
  if (totalGap)   html += ` <span class="cat-badge small" style="background:#d64ebe1f;border:1px solid #d64ebe4d;color:#d64ebe">Air Gap ${totalGap}</span>`;

  if (conBotonCerrar) {
    html += `<div style="flex:1"></div>
             <div onclick="toggleMapa(null)" style="cursor:pointer;color:var(--t3);font-size:14px">✕</div>`;
  }

  html += `</div>`;

  // ── Barras mensuales ──────────────────────────────────────────────────
  html += buildBarrasMensuales(id);

  // ── Breakdown subgrupos + timeline ───────────────────────────────────
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--b1)">
    <div style="padding:9px 12px;border-right:1px solid var(--b1)">
      <div style="font-size:.46rem;color:var(--t3);font-family:var(--font-mono);
                  text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">
        Breakdown por subgrupo
      </div>
      ${buildSubgrupoBars(warn)}
    </div>
    <div style="padding:9px 12px">
      <div style="font-size:.46rem;color:var(--t3);font-family:var(--font-mono);
                  text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">
        Historial inspecciones y mantenimiento
      </div>
      ${buildTimeline(id)}
    </div>
  </div>`;

  // ── Inspección Joao ──────────────────────────────────────────────────
  if (hist.insp_joao?.realizada && hist.insp_joao?.comentario) {
    html += `<div style="padding:7px 12px;border-top:1px solid var(--b1);background:rgba(232,212,77,.03)">
      <span style="font-family:var(--font-mono);font-size:.46rem;color:#e8d44d;font-weight:700">
        INSP. JOAO ALVEZ — ${hist.insp_joao.fecha || ''}
      </span>
      <div style="font-size:.58rem;color:var(--t2);margin-top:2px">${hist.insp_joao.comentario}</div>
    </div>`;
  }

  // ── Comentarios ──────────────────────────────────────────────────────
  if (hist.comentarios) {
    html += `<div style="padding:7px 12px;border-top:1px solid var(--b1);background:rgba(255,170,50,.03)">
      <span style="font-family:var(--font-mono);font-size:.46rem;color:#ffaa33;font-weight:700">COMENTARIOS</span>
      <div style="font-size:.58rem;color:var(--t2);margin-top:2px">${hist.comentarios}</div>
    </div>`;
  }

  return html + `</div>`;
}

/* ── Barras mensuales con eventos superpuestos ─────────────────────────── */

function buildBarrasMensuales(id) {
  const warn = warnings[id] || {};
  const est  = estado[id]   || {};
  const hist = historico[id] || {};

  // Array de valores mensuales totales
  const pm = MESES_KEYS.map(k => warn.mensual?.[k] || 0);
  const mx = Math.max(...pm) || 1;

  // Subtipos presentes
  const subtipos = Object.keys(SUBTIPO_COLORES).filter(s => (warn.por_tipo?.[s] || 0) > 0);

  // Eventos por mes (mantenimientos, cambios, inspecciones)
  const eventos = buildEventosPorMes(est, hist);

  let html = `<div style="padding:9px 12px">
    <div style="font-size:.46rem;color:var(--t3);font-family:var(--font-mono);
                text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">
      Warnings mes a mes — por tipo
    </div>
    <div class="months-grid">`;

  pm.forEach((v, i) => {
    const bH    = Math.max(v > 0 ? 4 : 0, Math.round(v / mx * 62));
    const evento = eventos[i];

    // Segmentos apilados por subtipo proporcional
    let segs = '';
    if (v > 0) {
      subtipos.forEach(sg => {
        const total = totalWarnings(id) || 1;
        const proporcion = (warn.por_tipo?.[sg] || 0) / total;
        const sv   = Math.round(proporcion * v);
        if (sv > 0) {
          const sh = Math.max(1, Math.round(sv / v * bH));
          segs += `<div style="width:100%;height:${sh}px;background:${SUBTIPO_COLORES[sg]}"
                        title="${sg}: ~${sv}"></div>`;
        }
      });
    }

    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;position:relative">`;

    if (evento) {
      html += `<div class="event-line" style="border-left-color:${evento.color}"
                    title="${evento.label}"></div>`;
    }

    html += `<div style="font-family:var(--font-mono);font-size:.38rem;color:var(--t3);
                  white-space:nowrap;overflow:hidden;position:relative;z-index:3">
                ${MESES_LABELS[i]}
             </div>`;

    html += `<div style="height:65px;display:flex;align-items:flex-end;width:100%;
                  justify-content:center;position:relative;z-index:3">
               <div style="width:80%;display:flex;flex-direction:column-reverse;
                           border-radius:2px 2px 0 0;overflow:hidden">
                 ${segs}
               </div>
             </div>`;

    html += `<div style="font-family:var(--font-mono);font-size:.42rem;font-weight:600;
                  color:${v ? 'var(--t1)' : 'var(--t3)'};position:relative;z-index:3">
               ${v || ''}
             </div>`;

    if (evento) {
      html += `<div style="font-family:var(--font-mono);font-size:.36rem;color:${evento.color};
                    white-space:nowrap;position:relative;z-index:3;margin-top:1px">
                 ${evento.label}
               </div>`;
    } else {
      html += `<div style="height:10px"></div>`;
    }

    html += `</div>`;
  });

  html += `</div></div>`;

  // Leyenda subtipos
  html += `<div class="panel-legend">`;
  subtipos.forEach(sg => {
    html += `<span><span class="legend-dot" style="background:${SUBTIPO_COLORES[sg]}"></span>${sg}</span>`;
  });
  html += `<span style="margin-left:6px;border-left:1px solid var(--b2);padding-left:6px">
             <span class="legend-dot" style="background:#00d090"></span>Mant.
           </span>
           <span><span class="legend-dot" style="background:#e8d44d"></span>Insp.</span>`;
  if (hist.cambio_frontal) html += `<span><span class="legend-dot" style="background:#6aabf7"></span>Camb.Front</span>`;
  if (hist.cambio_trasero) html += `<span><span class="legend-dot" style="background:#e060b0"></span>Camb.Tras</span>`;
  html += `</div>`;

  return html;
}

/** Construye un mapa { mesIndex → { color, label } } con los eventos de la turbina. */
function buildEventosPorMes(est, hist) {
  const ev = {};

  const add = (fecha, color, label) => {
    const mi = mesIndex(fecha);
    if (mi < 0) return;
    if (!ev[mi]) ev[mi] = { color, label };
    else ev[mi].label += ` + ${label}`;
  };

  add(est.fecha_ultima,  '#00d090', est.tipo_ultima?.replace('Mantenimiento ', '') || 'Mant.');
  add(hist.insp_joao?.fecha, '#e8d44d', 'Insp.');
  add(hist.cambio_frontal, '#6aabf7', 'Camb.Front');
  add(hist.cambio_trasero, '#e060b0', 'Camb.Tras');

  // Si hay medidas en el histórico 2026
  (hist.medidas || []).forEach(m => {
    add(m.fecha, '#00d090', m.tipo?.replace('Mantenimiento ', '') || 'Mant.');
  });

  return ev;
}

/* ── Barras de subgrupos ─────────────────────────────────────────────────── */

function buildSubgrupoBars(warn) {
  const subtipos = warn.por_tipo || {};
  const entradas = Object.entries(subtipos)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  if (!entradas.length) {
    return `<div style="color:var(--t3);font-size:.52rem">Sin datos</div>`;
  }

  const maxVal = entradas[0][1] || 1;
  let html = '';

  entradas.forEach(([nombre, valor]) => {
    const color = SUBTIPO_COLORES[nombre] || '#4da6ff';
    const pct   = Math.round(valor / maxVal * 100);

    html += `<div class="sub-bar-row">
      <div class="sub-bar-label">${nombre}</div>
      <div class="sub-bar-track">
        <div class="sub-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="sub-bar-value" style="color:${color}">${valor}</div>
    </div>`;
  });

  return html;
}

/* ── Timeline de eventos ─────────────────────────────────────────────────── */

function buildTimeline(id) {
  const est  = estado[id]    || {};
  const hist = historico[id] || {};

  // Construir lista de eventos desde ambas fuentes
  const eventos = [];

  // Medidas del histórico
  (hist.medidas || []).forEach(m => {
    eventos.push({ fecha: m.fecha, tipo: m.tipo, cat_del: m.cat_del, cat_tras: m.cat_tras });
  });

  // Cambios de rodamiento
  if (hist.cambio_frontal) eventos.push({ fecha: hist.cambio_frontal, tipo: 'Cambio Rod. Frontal', cat_del: null, cat_tras: null });
  if (hist.cambio_trasero) eventos.push({ fecha: hist.cambio_trasero, tipo: 'Cambio Rod. Trasero', cat_del: null, cat_tras: null });

  // Inspección Joao
  if (hist.insp_joao?.fecha) {
    eventos.push({ fecha: hist.insp_joao.fecha, tipo: 'Insp. Joao Alvez', cat_del: null, cat_tras: hist.insp_joao.clase || est.insp_joao_clase || null });
  }

  // Ordenar por fecha
  eventos.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

  if (!eventos.length) {
    return `<div style="color:var(--t3);font-size:.52rem">Sin registros</div>`;
  }

  let html = `<table class="timeline-table">
    <thead><tr><th>Fecha</th><th>Evento</th><th>Del.</th><th>Tras.</th></tr></thead>
    <tbody>`;

  eventos.forEach(ev => {
    const esFrontal  = ev.tipo.includes('Frontal');
    const esTrasero  = ev.tipo.includes('Trasero') && ev.tipo.includes('Cambio');
    const esJoao     = ev.tipo.includes('Joao');
    const color      = esTrasero ? '#e060b0' : esFrontal ? '#6aabf7' : esJoao ? '#e8d44d' : '#00d090';
    const tipoCorto  = ev.tipo.replace('Mantenimiento ', '').replace('Insp. Joao Alvez', 'Insp. Joao');

    html += `<tr>
      <td style="font-size:.5rem;color:var(--t2)">${ev.fecha || ''}</td>
      <td>
        <span style="font-size:.44rem;padding:1px 4px;border-radius:3px;
                     background:${color}1a;border:1px solid ${color}44;
                     color:${color};font-family:var(--font-mono)">
          ${tipoCorto}
        </span>
      </td>
      <td>${catBadge(ev.cat_del, true)}</td>
      <td>${catBadge(ev.cat_tras, true)}</td>
    </tr>`;
  });

  return html + `</tbody></table>`;
}

/* ── Card de impacto de cambio de rodamiento ─────────────────────────────── */

function buildImpactoCambio(id) {
  // Calcular warnings antes y después del cambio del rodamiento trasero
  const hist  = historico[id] || {};
  const warn  = warnings[id]  || {};
  const fecha = hist.cambio_trasero;
  if (!fecha) return '';

  const mi = mesIndex(fecha);
  if (mi < 0) return '';

  const pm = MESES_KEYS.map(k => warn.mensual?.[k] || 0);
  const antes  = pm.slice(0, mi).reduce((a, v) => a + v, 0);
  const despues = pm.slice(mi + 1).reduce((a, v) => a + v, 0);
  const pct = antes > 0 ? Math.round((antes - despues) / antes * 100) : 0;

  return `<div class="card" style="margin-top:10px">
    <div class="card-header">Impacto cambio rodamiento trasero</div>
    <div class="card-body">
      <div style="display:grid;grid-template-columns:1fr auto 1fr;
                  background:var(--s3);border:1px solid var(--b1);border-radius:5px">
        <div style="padding:8px;text-align:center">
          <div style="font-size:.46rem;font-family:var(--font-mono);color:var(--t3);
                      text-transform:uppercase;margin-bottom:3px">Antes</div>
          <div style="font-family:var(--font-mono);font-size:1.1rem;font-weight:700;color:#fff">${antes}</div>
        </div>
        <div style="display:flex;align-items:center;padding:0 6px;
                    color:var(--b2);border-left:1px solid var(--b1);border-right:1px solid var(--b1)">→</div>
        <div style="padding:8px;text-align:center">
          <div style="font-size:.46rem;font-family:var(--font-mono);color:var(--t3);
                      text-transform:uppercase;margin-bottom:3px">Después</div>
          <div style="font-family:var(--font-mono);font-size:1.1rem;font-weight:700;color:#fff">${despues}</div>
          ${pct > 0 ? `<div style="font-size:.48rem;color:#00d090">-${pct}%</div>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════════════ */

async function init() {
  // Registrar eventos de tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => goToPage(btn.dataset.page));
  });

  // Cargar datos y renderizar
  await loadData();

  buildResumen();

  // Ocultar loading
  const loadingEl = document.getElementById('loading');
  loadingEl.classList.add('hidden');
  setTimeout(() => loadingEl.remove(), 350);
}

init();
