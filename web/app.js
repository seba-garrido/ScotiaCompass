import { icon } from './icons.js';
import { loadDemoConnections, saveDemoConnections, demoDatabases, demoCollections, demoQuery, demoWrite, demoIndexes } from './demo.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pretty = value => JSON.stringify(value, null, 2);
const state = {
  mode: 'demo', backend: false, auth: false, requiresAuth: false, connections: [], connection: '', ready: false, connecting: '',
  databases: [], database: '', collections: [], collection: '',
  filter: '{}', sort: '{ "_id": 1 }', projection: '{}', limit: 20, skip: 0, documents: [], revisions: [], hasMore: false,
  estimatedCount: null, duration: null, view: 'json', tab: 'documents', advanced: false, busy: false, error: '',
  indexes: [], saved: [], history: [], search: '', environment: 'ALL', request: 0, applied: null
};
let toastTimer, previousFocus;
const current = () => state.connections.find(c => c.id === state.connection);
const context = () => ({ connection: state.connection, database: state.database, collection: state.collection });
const canWrite = () => current()?.status === 'connected' && !current().readOnly && !state.busy && !!state.collection;
function toast(message) {
  const element = $('#toast'); element.textContent = message; element.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 3800);
}
async function api(route, body, method) {
  const response = await fetch(`/api/${route}`, { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: { 'X-Scotia-Client': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('El backend MongoDB no está disponible en esta vista. Ejecuta la aplicación local para conectar tus bases.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
  return data;
}
function badge(environment) { return `<span class="badge env-${esc(environment.toLowerCase())}">${esc(environment)}</span>`; }
function buttonIcon(name, label, action, extra = '') { return `<button class="icon-button" title="${esc(label)}" aria-label="${esc(label)}" data-action="${action}" ${extra}>${icon(name)}</button>`; }

function shell() {
  $('#app').innerHTML = `<header class="topbar">
    <button class="mobile-menu icon-button" aria-label="Abrir conexiones" data-action="menu">${icon('menu')}</button>
    <a class="brand" href="./" aria-label="Scotia Compass inicio"><img class="scotia-wordmark" src="./assets/scotiabank-white.svg" alt="Scotiabank" width="170" height="25"><span class="product-name">Compass</span></a>
    <span class="brand-divider"></span><span class="workspace-label">DATA WORKSPACE</span>
    <div class="top-actions"><span class="internal-label">Una vista. Todas tus conexiones.</span>
      <div class="theme-switch" role="group" aria-label="Tema de la interfaz"><button data-action="theme" data-theme-value="light" aria-label="Tema claro" aria-pressed="false" title="Tema claro">${icon('sun')}<span>Claro</span></button><button data-action="theme" data-theme-value="dark" aria-label="Tema oscuro" aria-pressed="false" title="Tema oscuro">${icon('moon')}<span>Oscuro</span></button></div>
      <button class="mode-switch" data-action="mode"><span class="dot amber"></span><span id="mode-label">Modo demostración</span>${icon('down')}</button>
      ${buttonIcon('help', 'Ayuda y atajos', 'help')}<span class="avatar" title="Scotia Compass">SC</span>
    </div></header>
    <aside class="sidebar" id="sidebar">
      <div class="side-nav"><span class="overline">ESPACIO DE TRABAJO</span><button class="nav-item active" data-action="explorer">${icon('grid')}Explorador<span class="nav-current"></span></button>
      <button class="nav-item" data-action="saved">${icon('bookmark')}Consultas guardadas<span id="saved-count" class="nav-count">0</span></button>
      <button class="nav-item" data-action="history">${icon('history')}Historial de consultas</button></div>
      <div class="connections-heading"><span class="overline">CONEXIONES <span id="connection-count">0</span></span>${buttonIcon('plus', 'Agregar conexión', 'connect')}</div>
      <div class="side-search">${icon('search')}<input id="search-connections" aria-label="Buscar conexión" placeholder="Buscar conexión…"><kbd>/</kbd></div>
      <div class="environment-filter"><label for="environment">Ambiente</label><select id="environment"><option value="ALL">Todos los ambientes</option><option>IST</option><option>UAT</option><option value="PROD">Producción</option></select></div>
      <div id="connection-tree" class="connection-tree"></div>
      <button class="new-connection" data-action="connect">${icon('plus')}Nueva conexión</button>
      <div class="sidebar-bottom"><div class="workspace-card"><span class="workspace-card-icon">${icon('lock')}</span><div><strong>Tu espacio de datos</strong><span id="sidebar-mode">Datos de ejemplo · sesión local</span></div></div>
      <button class="nav-item" data-action="settings">${icon('settings')}Configuración${icon('chevron', 'push-right')}</button><div class="sidebar-brand"><img class="logo-on-light" src="./assets/scotiabank-red.svg" alt="Scotiabank" width="104" height="15"><img class="logo-on-dark" src="./assets/scotiabank-white.svg" alt="Scotiabank" width="104" height="15"><span>DATA WORKSPACE</span></div></div>
    </aside>
    <main id="workspace" class="workspace"></main>
    <footer class="statusbar"><span><span class="dot green"></span><span id="status-mode">Entorno de demostración</span></span><span id="status-namespace">db_eventlog.EventLog</span><span class="status-shortcut"><kbd>Ctrl</kbd> + <kbd>↵</kbd> Ejecutar consulta</span></footer>`;
  $('#search-connections').addEventListener('input', e => { state.search = e.target.value; renderConnections(); });
  $('#environment').addEventListener('change', e => { state.environment = e.target.value; renderConnections(); });
  updateThemeButtons(); renderConnections(); renderWorkspace();
}
function updateThemeButtons() {
  const selected = window.scotiaTheme.get();
  document.querySelectorAll('[data-theme-value]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeValue === selected)));
}
document.addEventListener('scotia-theme-change', updateThemeButtons);
function renderConnections() {
  $('#connection-count').textContent = state.connections.length;
  const filtered = state.connections.filter(c => (state.environment === 'ALL' || c.environment === state.environment) && `${c.name} ${c.provider} ${c.environment}`.toLowerCase().includes(state.search.toLowerCase()));
  $('#connection-tree').innerHTML = filtered.length ? filtered.map(c => `<div class="connection-group ${c.id === state.connection ? 'selected-group' : ''}">
    <button class="connection-item ${c.id === state.connection ? 'selected' : ''}" data-connection="${esc(c.id)}"><span class="connection-icon profile-${esc(c.color || 'red')}">${icon(c.provider === 'Atlas' ? 'cloud' : 'server')}</span><span class="connection-name">${esc(c.name)}</span>${badge(c.environment)}${icon(c.id === state.connection ? 'down' : 'chevron', 'tiny')}</button>
    <div class="connection-controls"><span class="profile-status"><span class="dot ${c.status === 'connected' ? 'green' : 'gray'}"></span>${state.connecting === c.id ? 'Conectando…' : c.status === 'connected' ? 'Conectada' : 'Desconectada'}</span><button class="profile-toggle" data-action="${c.status === 'connected' ? 'disconnect-profile' : 'reconnect-profile'}" data-profile="${esc(c.id)}" ${state.connecting ? 'disabled' : ''}>${c.status === 'connected' ? 'Desconectar' : 'Conectar'}</button>${buttonIcon('settings', 'Configurar conexión', 'profile-details', `data-profile="${esc(c.id)}"`)}</div>
    ${c.id === state.connection && c.status === 'connected' ? `<div class="database-tree">${state.databases.map(db => `<button class="database-item ${db === state.database ? 'current' : ''}" data-database="${esc(db)}">${icon(db === state.database ? 'down' : 'chevron', 'tiny')}${icon('database')}<span>${esc(db)}</span></button>${db === state.database ? `<div class="collection-list">${state.collections.map(col => `<button class="collection-item ${col === state.collection ? 'current' : ''}" data-collection="${esc(col)}">${icon('table')}<span>${esc(col)}</span>${col === state.collection ? '<span class="collection-dot"></span>' : ''}</button>`).join('')}</div>` : ''}`).join('')}</div>` : ''}</div>`).join('') : `<div class="side-empty">${state.connections.length ? 'Sin coincidencias.' : 'Todavía no tienes conexiones guardadas.'}</div>`;
  $('#mode-label').textContent = state.mode === 'demo' ? 'Modo demostración' : 'Conexiones reales';
  $('.mode-switch').classList.toggle('live', state.mode === 'live');
  $('#sidebar-mode').textContent = state.mode === 'demo' ? 'Simulación · sin credenciales reales' : 'Conexiones guardadas y cifradas';
  $('#status-mode').textContent = state.mode === 'demo' ? 'Entorno de demostración' : 'Backend MongoDB';
  $('#saved-count').textContent = state.saved.length;
}
function renderWorkspace() {
  const c = current();
  $('#status-namespace').textContent = state.collection ? `${state.database}.${state.collection}` : 'Sin colección seleccionada';
  if (!c) {
    $('#workspace').innerHTML = `<div class="empty-workspace"><span class="empty-icon">${icon('compass')}</span><span class="overline">${state.connections.length ? 'TUS CONEXIONES, A UN CLIC' : 'TU WORKSPACE EMPIEZA AQUÍ'}</span><h1>${state.ready ? 'Conecta tus datos.' : 'Preparando tu workspace…'}</h1><p>${state.connections.length ? 'Selecciona una conexión guardada y presiona Conectar.<br>También puedes agregar otra conexión.' : 'Crea tu primera conexión para explorar MongoDB.<br>Personaliza su nombre, configura la URI y conecta.'}</p><button class="button primary" data-action="connect" ${state.ready ? '' : 'disabled'}>${icon('plus')}Nueva conexión</button><div class="welcome-steps"><span><b>01</b>Configura</span><span><b>02</b>Conecta</span><span><b>03</b>Explora</span></div><p class="empty-note">${state.mode === 'demo' ? 'Vista de demostración. Puedes simular el flujo sin ingresar credenciales reales.' : 'Las conexiones se guardan al conectar correctamente.<br>Desconectarte conserva su configuración para la próxima vez.'}</p>${state.error ? `<p class="error-text">${esc(state.error)}</p>` : ''}</div>`;
    return;
  }
  if (c.status !== 'connected') {
    $('#workspace').innerHTML = `<div class="empty-workspace disconnected-workspace"><span class="empty-icon profile-${esc(c.color || 'red')}">${icon(c.provider === 'Atlas' ? 'cloud' : 'server')}</span><span class="overline">CONEXIÓN GUARDADA</span><h1>${esc(c.name)}</h1><div class="saved-profile-meta">${badge(c.environment)}<span>MongoDB ${esc(c.provider)}</span><span class="profile-status"><span class="dot gray"></span>Desconectada</span></div><p>Tu configuración está guardada.<br>Conecta cuando quieras volver a explorar tus datos.</p><div class="saved-profile-actions"><button class="button primary" data-action="reconnect-profile" data-profile="${esc(c.id)}" ${state.connecting ? 'disabled' : ''}>${icon('bolt')}${state.connecting === c.id ? 'Conectando…' : 'Conectar'}</button><button class="button" data-action="edit-profile" data-profile="${esc(c.id)}">${icon('edit')}Editar conexión</button></div><button class="text-button remove-profile-link" data-action="remove-profile" data-profile="${esc(c.id)}">${icon('trash')}Eliminar conexión guardada</button>${state.error ? `<p class="error-text">${esc(state.error)}</p>` : ''}</div>`;
    return;
  }
  const projectionActive = Object.keys(state.applied?.projection || {}).length > 0;
  $('#workspace').innerHTML = `
    <div class="breadcrumb">${icon('grid')}<span>Conexiones</span>${icon('chevron')}<span>${esc(c.name)}</span>${icon('chevron')}<span>${esc(state.database || 'Seleccionar base')}</span>${icon('chevron')}<strong>${esc(state.collection || 'Sin colecciones')}</strong></div>
    <div class="page-heading"><div class="title-group"><span class="collection-avatar">${icon('database')}</span><div><div class="title-line"><h1>${esc(state.collection || state.database || 'Explorador')}</h1><span class="collection-label">Colección</span></div><p>Explora y administra tus documentos en un solo lugar.</p></div></div><div class="heading-actions"><button class="button" data-action="refresh" ${state.busy ? 'disabled' : ''}>${icon('refresh')}Actualizar</button><button class="button primary" data-action="insert" ${canWrite() ? '' : 'disabled'}>${icon('plus')}Insertar documento</button></div></div>
    <div class="connection-strip"><span class="connection-state"><span class="dot ${state.error ? 'amber' : 'green'}"></span>${state.mode === 'demo' ? 'Conexión de ejemplo' : state.busy ? 'Consultando…' : state.error ? 'Revisar conexión' : 'Conexión seleccionada'}</span><span class="strip-separator"></span>${icon(c.provider === 'Atlas' ? 'cloud' : 'server')}<strong>MongoDB ${esc(c.provider)}</strong>${badge(c.environment)}<span class="strip-separator"></span>${icon(c.readOnly ? 'lock' : 'edit')}<span>${c.readOnly ? 'Solo lectura' : 'Lectura y escritura'}</span><button class="text-button connection-details" data-action="connection-details">Ver conexión${icon('arrow')}</button></div>
    ${state.mode === 'demo' ? `<div class="demo-notice">${icon('info')}<span><strong>Estás explorando una demo.</strong> Los documentos son ficticios y los cambios duran esta sesión.</span><button data-action="mode">Conectar mis datos${icon('arrow')}</button></div>` : c.environment === 'PROD' ? `<div class="production-notice">${icon('lock')}Ambiente de producción · ${c.readOnly ? 'Las escrituras están deshabilitadas en esta conexión.' : 'Cada escritura requiere confirmar la colección.'}</div>` : ''}
    <div class="metrics"><div class="metric"><span class="metric-icon">${icon('document')}</span><div><span class="metric-label">Documentos${state.mode === 'live' ? ' · estimado' : ' de ejemplo'}</span><strong>${state.estimatedCount === null ? '—' : new Intl.NumberFormat('es-CL').format(state.estimatedCount)}</strong></div><span class="metric-caption">En la colección</span></div><div class="metric"><span class="metric-icon">${icon('branch')}</span><div><span class="metric-label">Índices</span><strong>${state.indexes.length || '—'}</strong></div><button class="metric-link" data-action="indexes">Ver índices${icon('arrow')}</button></div><div class="metric"><span class="metric-icon">${icon('bolt')}</span><div><span class="metric-label">Última consulta</span><strong>${state.duration === null ? '—' : state.duration}<small>${state.duration === null ? '' : 'ms'}</small></strong></div><span class="metric-caption">${state.mode === 'demo' ? 'Motor de demostración' : 'Tiempo de consulta'}</span></div></div>
    <div class="tabs" role="tablist" aria-label="Vista de la colección"><button role="tab" aria-selected="${state.tab === 'documents'}" class="tab ${state.tab === 'documents' ? 'active' : ''}" data-action="documents">${icon('document')}Documentos</button><button role="tab" aria-selected="${state.tab === 'indexes'}" class="tab ${state.tab === 'indexes' ? 'active' : ''}" data-action="indexes">${icon('branch')}Índices<span>${state.indexes.length}</span></button><button role="tab" aria-selected="${state.tab === 'schema'}" class="tab ${state.tab === 'schema' ? 'active' : ''}" data-action="schema">${icon('grid')}Esquema de la muestra</button><span class="tabs-end">${icon('database')}${esc(state.database)}</span></div>
    ${state.tab === 'documents' ? `<section class="query-panel" aria-label="Editor de consultas"><div class="query-heading"><span class="query-label">${icon('filter')}FILTRO <span>MongoDB Query Language</span></span><div class="query-tools"><button class="text-button" data-action="save">${icon('bookmark')}Guardar consulta</button><button class="text-button ${state.advanced ? 'selected-text' : ''}" data-action="advanced">Opciones${icon('down')}</button></div></div><div class="query-input-row"><span class="line-number">1</span><textarea id="query-filter" spellcheck="false" rows="2" aria-label="Filtro MongoDB" placeholder='{ "status": "ERROR" }'>${esc(state.filter)}</textarea><button class="button primary run-button" data-action="run" ${state.busy || !state.collection ? 'disabled' : ''}>${state.busy ? '<span class="spinner"></span>' : icon('play')}${state.busy ? 'Consultando' : 'Ejecutar'}<kbd>⌘ ↵</kbd></button></div><div class="query-bottom"><span>Consultas rápidas</span><button class="query-chip" data-preset="all">Todos los documentos</button><button class="query-chip" data-preset="errors"><span class="dot red"></span>Errores</button><button class="query-chip" data-preset="today">${icon('history')}Últimas 24 h</button><button class="text-button reset-query" data-action="reset">Restablecer</button></div>${state.advanced ? `<div class="advanced-options"><label>Orden <input id="query-sort" class="mono" value="${esc(state.sort)}" aria-label="Orden JSON"></label><label>Proyección <input id="query-projection" class="mono" value="${esc(state.projection)}" aria-label="Proyección JSON"></label><label>Documentos por página <select id="query-limit"><option ${state.limit === 10 ? 'selected' : ''}>10</option><option ${state.limit === 20 ? 'selected' : ''}>20</option><option ${state.limit === 50 ? 'selected' : ''}>50</option><option ${state.limit === 100 ? 'selected' : ''}>100</option></select></label></div>` : ''}</section>
    ${state.error ? `<div class="error-banner" role="alert">${icon('info')}<span>${esc(state.error)}</span></div>` : ''}
    <div class="results-toolbar"><div><strong>Resultados</strong><span class="result-count">${state.documents.length ? `${state.skip + 1}–${state.skip + state.documents.length}` : '0'} documentos</span>${state.duration !== null ? `<span class="query-success">${icon('check')}${state.duration} ms</span>` : ''}</div><div class="results-actions"><div class="view-switch" aria-label="Vista de resultados"><button aria-label="Vista JSON" class="${state.view === 'json' ? 'active' : ''}" data-action="json">${icon('code')}JSON</button><button aria-label="Vista tabla" class="${state.view === 'table' ? 'active' : ''}" data-action="table">${icon('table')}Tabla</button></div><button class="button export-button" data-action="export" ${state.documents.length ? '' : 'disabled'}>${icon('download')}Exportar página</button></div></div>
    ${projectionActive ? '<div class="projection-notice">Vista con proyección. Ejecuta con proyección {} para editar o eliminar el documento completo.</div>' : ''}
    <section class="results ${state.busy ? 'loading' : ''}" aria-label="Documentos encontrados" aria-busy="${state.busy}">${state.documents.length ? (state.view === 'json' ? state.documents.map(renderDocument).join('') : renderTable()) : `<div class="empty-results">${icon(state.busy ? 'history' : 'search')}<h3>${state.busy ? 'Consultando documentos…' : state.error ? 'No se pudieron cargar los documentos' : 'No hay documentos para este filtro'}</h3><p>${state.busy ? 'Preparando los resultados de tu consulta.' : state.error ? 'Revisa el mensaje de error y vuelve a ejecutar la consulta.' : 'Prueba otro filtro o inserta tu primer documento.'}</p></div>`}</section>
    <div class="pagination"><span>Máximo ${state.limit} documentos por página<span class="pagination-detail"> · Consulta acotada a 10 s</span></span><div><button class="button" data-action="previous" ${state.skip === 0 || state.busy ? 'disabled' : ''}>${icon('chevron', 'rotate')}Anterior</button><span>Página ${Math.floor(state.skip / state.limit) + 1}</span><button class="button" data-action="next" ${!state.hasMore || state.busy ? 'disabled' : ''}>Siguiente${icon('chevron')}</button></div></div>` : state.tab === 'indexes' ? renderIndexes() : renderSchema()}
    <div class="workspace-end">${icon('lock')}Scotia Compass<span>Tu información, en tu entorno.</span></div>`;
}
function typed(value) {
  if (value === null) return '<span class="syntax-null">null</span>';
  if (typeof value === 'object') {
    if (value.$oid) return `<span class="syntax-type">ObjectId</span><span class="syntax-punctuation">(</span><span class="syntax-string">"${esc(value.$oid)}"</span><span class="syntax-punctuation">)</span>`;
    if (value.$date) { const d = value.$date.$numberLong ? new Date(Number(value.$date.$numberLong)).toISOString() : value.$date; return `<span class="syntax-type">ISODate</span><span class="syntax-punctuation">(</span><span class="syntax-string">"${esc(d)}"</span><span class="syntax-punctuation">)</span>`; }
    if (value.$numberInt || value.$numberLong || value.$numberDouble || value.$numberDecimal) return `<span class="syntax-number">${esc(value.$numberInt || value.$numberLong || value.$numberDouble || value.$numberDecimal)}</span>`;
    return `<span class="syntax-punctuation">${Array.isArray(value) ? `[ ${value.length} elementos ]` : `{ ${Object.keys(value).length} campos }`}</span>`;
  }
  if (typeof value === 'string') return `<span class="syntax-string">"${esc(value)}"</span>`;
  return `<span class="syntax-number">${esc(value)}</span>`;
}
function idText(value) { return value?.$oid || (typeof value === 'object' ? JSON.stringify(value) : String(value ?? 'sin _id')); }
function renderDocument(doc, index) {
  const editable = canWrite() && state.revisions[index] && !Object.keys(state.applied?.projection || {}).length;
  return `<article class="document-card"><div class="document-header"><span class="document-number">${String(state.skip + index + 1).padStart(2, '0')}</span><span class="document-id">${icon('document')}<span>${esc(idText(doc._id))}</span></span>${doc.status ? `<span class="document-status status-${esc(String(doc.status).toLowerCase())}"><span class="dot"></span>${esc(doc.status)}</span>` : ''}<div class="document-actions">${buttonIcon('code', 'Ver documento completo', 'inspect', `data-index="${index}"`)}${buttonIcon('copy', 'Copiar documento', 'copy', `data-index="${index}"`)}${buttonIcon('edit', 'Editar documento', 'edit', `data-index="${index}" ${editable ? '' : 'disabled'}`)}${buttonIcon('trash', 'Eliminar documento', 'delete', `data-index="${index}" ${editable ? '' : 'disabled'}`)}</div></div><div class="document-body">${Object.entries(doc).slice(0, 9).map(([key, value], row) => `<div class="code-row"><span class="code-number">${row + 1}</span><span class="code-key">${esc(key)}</span><span class="code-colon">:</span><span class="code-value">${typed(value)}</span>${key === '_id' ? '<span class="field-type">Object ID</span>' : ''}</div>`).join('')}</div><button class="document-expand" data-action="inspect" data-index="${index}">${icon('code')}Ver documento completo${icon('arrow')}</button></article>`;
}
function renderTable() {
  const keys = [...new Set(state.documents.flatMap(Object.keys))].slice(0, 7);
  return `<div class="table-wrapper"><table><thead><tr>${keys.map(k => `<th>${esc(k)}</th>`).join('')}<th>Detalle</th></tr></thead><tbody>${state.documents.map((doc, i) => `<tr>${keys.map(k => `<td>${doc[k] === undefined ? '<span class="muted">—</span>' : typed(doc[k])}</td>`).join('')}<td>${buttonIcon('code', 'Ver documento completo', 'inspect', `data-index="${i}"`)}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderIndexes() {
  return `<section class="secondary-panel"><div class="section-heading"><div><h2>Índices de la colección</h2><p>Consulta las claves que utiliza MongoDB para acceder a tus documentos.</p></div><span class="badge neutral">Solo consulta</span></div>${state.error ? `<p class="error-text">${esc(state.error)}</p>` : ''}<div class="table-wrapper"><table><thead><tr><th>Nombre</th><th>Campos y orden</th><th>Propiedades</th></tr></thead><tbody>${state.indexes.map(idx => `<tr><td><span class="index-name">${icon('branch')}${esc(idx.name)}</span></td><td class="mono">${esc(JSON.stringify(idx.key))}</td><td><span class="badge neutral">${idx.unique || idx.name === '_id_' ? 'Único' : 'Regular'}</span>${idx.expireAfterSeconds !== undefined ? ' · TTL' : ''}</td></tr>`).join('')}</tbody></table></div>${!state.indexes.length ? '<div class="empty-results"><p>No hay índices disponibles. Comprueba los permisos de la conexión.</p></div>' : ''}</section>`;
}
function renderSchema() {
  const fields = new Map();
  for (const doc of state.documents) for (const [key, value] of Object.entries(doc)) {
    const type = value === null ? 'null' : value?.$oid ? 'ObjectId' : value?.$date ? 'Date' : value?.$numberInt ? 'Int32' : value?.$numberLong ? 'Int64' : value?.$numberDouble ? 'Double' : value?.$numberDecimal ? 'Decimal128' : Array.isArray(value) ? 'Array' : typeof value;
    const entry = fields.get(key) || { count: 0, types: new Set() }; entry.count++; entry.types.add(type); fields.set(key, entry);
  }
  return `<section class="secondary-panel"><div class="section-heading"><div><h2>Una mirada a tus documentos</h2><p>Campos de los ${state.documents.length} documentos de la página actual. La muestra no representa toda la colección.</p></div><span class="badge neutral">Muestra actual</span></div><table><thead><tr><th>Campo</th><th>Tipos detectados</th><th>Presencia en la muestra</th></tr></thead><tbody>${[...fields].map(([key, field]) => `<tr><td class="mono">${esc(key)}</td><td>${[...field.types].map(t => `<span class="type-pill">${esc(t)}</span>`).join(' ')}</td><td>${field.count} / ${state.documents.length} documentos</td></tr>`).join('')}</tbody></table></section>`;
}
function captureInputs() {
  if ($('#query-filter')) state.filter = $('#query-filter').value;
  if ($('#query-sort')) state.sort = $('#query-sort').value;
  if ($('#query-projection')) state.projection = $('#query-projection').value;
  if ($('#query-limit')) state.limit = Number($('#query-limit').value);
}
function parseObject(text, label) {
  let value; try { value = JSON.parse(text || '{}'); } catch { throw new Error(`${label}: JSON inválido. Usa comillas dobles y Extended JSON para tipos BSON.`); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label} debe ser un objeto JSON.`);
  return value;
}
async function runQuery(reset = true, useApplied = false) {
  if (!state.collection) { renderWorkspace(); return; }
  captureInputs();
  const request = ++state.request;
  const target = context();
  try {
    const parsed = useApplied && state.applied ? { ...state.applied } : { filter: parseObject(state.filter, 'Filtro'), sort: parseObject(state.sort, 'Orden'), projection: parseObject(state.projection, 'Proyección'), limit: state.limit };
    state.limit = parsed.limit;
    if (reset) state.skip = 0;
    const body = { ...target, ...parsed, skip: state.skip };
    state.busy = true; state.error = ''; renderWorkspace();
    const result = state.mode === 'demo' ? await demoQuery(body) : await api('query', body);
    if (state.request !== request) return;
    state.documents = result.documents; state.revisions = result.revisions; state.hasMore = result.hasMore; state.duration = result.duration; state.applied = parsed;
    if (result.estimatedCount !== undefined) state.estimatedCount = result.estimatedCount;
    state.history.unshift({ name: `${state.collection} · ${new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`, ...target, ...parsed, mode: state.mode });
    state.history = state.history.slice(0, 30);
  } catch (e) {
    if (state.request !== request) return;
    state.error = e.message; state.documents = []; state.revisions = []; state.hasMore = false; state.duration = null;
  } finally { if (state.request === request) { state.busy = false; renderWorkspace(); } }
}
async function metadata() {
  const target = context(); const identity = JSON.stringify(target);
  if (!target.collection) return;
  if (state.mode === 'demo') state.indexes = demoIndexes(state.collection);
  else {
    const [stats, indexes] = await Promise.allSettled([api('stats', target), api('indexes', target)]);
    if (JSON.stringify(context()) !== identity || state.mode !== 'live') return;
    state.estimatedCount = stats.status === 'fulfilled' ? Number(stats.value.estimatedCount) : null;
    state.indexes = indexes.status === 'fulfilled' ? indexes.value : [];
  }
  renderWorkspace();
}
function resetResults() { state.request++; state.documents = []; state.revisions = []; state.indexes = []; state.estimatedCount = null; state.duration = null; state.skip = 0; state.hasMore = false; state.error = ''; state.filter = '{}'; state.projection = '{}'; state.sort = '{ "_id": 1 }'; state.applied = null; state.tab = 'documents'; }
async function selectConnection(id) {
  resetResults(); state.connection = id; state.databases = []; state.collections = []; state.database = ''; state.collection = ''; state.busy = true; renderConnections(); renderWorkspace();
  if (current()?.status !== 'connected') { state.busy = false; renderWorkspace(); return; }
  const request = state.request;
  try {
    const databases = state.mode === 'demo' ? demoDatabases() : await api(`databases?connection=${encodeURIComponent(id)}`);
    if (request !== state.request) return;
    state.databases = databases; state.database = databases[0] || '';
    await selectDatabase(state.database);
  } catch (e) { if (request === state.request) { state.error = e.message; state.busy = false; renderWorkspace(); } }
}
async function selectDatabase(database) {
  resetResults(); state.database = database; state.collections = []; state.collection = ''; state.busy = true; renderConnections(); renderWorkspace();
  const request = state.request;
  try {
    const collections = !database ? [] : state.mode === 'demo' ? demoCollections(database) : await api(`collections?connection=${encodeURIComponent(state.connection)}&database=${encodeURIComponent(database)}`);
    if (request !== state.request) return;
    state.collections = collections; state.collection = collections.includes('EventLog') ? 'EventLog' : collections[0] || ''; state.busy = false;
    renderConnections(); await Promise.all([runQuery(), metadata()]);
  } catch (e) { if (request === state.request) { state.error = e.message; state.busy = false; renderConnections(); renderWorkspace(); } }
}
async function selectCollection(collection) { resetResults(); state.collection = collection; renderConnections(); await Promise.all([runQuery(), metadata()]); }
function modal(title, subtitle, body, footer = '', wide = false) {
  previousFocus = document.activeElement;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-heading"><div><h2 id="modal-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div>${buttonIcon('close', 'Cerrar diálogo', 'close-modal')}</div><div class="modal-body">${body}<div id="modal-error" class="error-text" role="alert"></div></div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</section></div>`;
  queueMicrotask(() => ($('input, textarea, select', $('.modal-body')) || $('button', $('.modal')))?.focus());
}
function closeModal() { $('#modal-root').innerHTML = ''; previousFocus?.focus(); }
function showMode() {
  modal('Tu espacio de trabajo', 'Elige cómo quieres explorar tus datos.', `<button class="mode-card" data-action="demo-mode"><span class="mode-card-icon">${icon('compass')}</span><span><strong>Explorar la demostración</strong><small>Conexiones y documentos ficticios. Prueba consultas y CRUD.</small></span>${icon('arrow')}</button><button class="mode-card" data-action="live-mode"><span class="mode-card-icon red-tint">${icon('database')}</span><span><strong>Conectar a MongoDB</strong><small>Crea y guarda tus conexiones para volver a conectarte cuando quieras.</small></span>${icon('arrow')}</button>${!state.backend ? '<div class="info-box">Esta vista contiene la demo. Para conectar bases reales, ejecuta <code>npm run dev</code> en el proyecto local y abre <strong>http://127.0.0.1:4317</strong>. El servidor necesita acceso de red a MongoDB.</div>' : ''}`);
}
async function switchMode(mode) {
  if (state.connecting) { toast('Espera a que termine la operación de conexión.'); return; }
  if (mode === 'live' && !state.backend) { $('#modal-error').textContent = 'Las conexiones reales están disponibles al ejecutar el backend local o interno.'; return; }
  if (mode === 'live' && state.requiresAuth && !state.auth) { login(); return; }
  closeModal(); resetResults(); state.mode = mode; state.connections = mode === 'demo' ? loadDemoConnections() : await api('connections');
  state.connection = ''; state.databases = []; state.collections = []; state.database = ''; state.collection = ''; state.busy = false;
  renderConnections(); renderWorkspace();
}
function login() {
  modal('Acceder al workspace', 'Ingresa la clave de acceso de esta instancia.', '<label class="form-field">Clave de acceso<input id="access-token" type="password" autocomplete="current-password" placeholder="APP_ACCESS_TOKEN"></label>', '<button class="button" data-action="close-modal">Cancelar</button><button class="button primary" id="login-submit">Acceder</button>');
  $('#login-submit').onclick = async e => { const btn = e.currentTarget; btn.disabled = true; try { await api('session', { token: $('#access-token').value }); state.auth = true; await switchMode('live'); } catch (err) { $('#modal-error').textContent = err.message; btn.disabled = false; } };
}
function showConnectionForm(id) {
  if (!state.ready || state.connecting) return;
  if (state.mode === 'live' && state.requiresAuth && !state.auth) { login(); return; }
  const previous = state.connections.find(c => c.id === id);
  const simulated = state.mode === 'demo';
  modal(previous ? 'Editar conexión' : 'Nueva conexión', simulated ? 'Simula el flujo de conexión con datos ficticios.' : 'Configura tu conexión. Se guardará cuando la prueba sea exitosa.', `<label class="form-field">Nombre de la conexión<input id="conn-name" maxlength="80" placeholder="Ej. Event Log · IST" value="${esc(previous?.name || '')}" autocomplete="off"></label><div class="form-grid"><label class="form-field">Proveedor<select id="conn-provider"><option>Atlas</option><option>Anthos</option></select></label><label class="form-field">Ambiente<select id="conn-environment"><option>IST</option><option>UAT</option><option value="PROD">Producción</option></select></label></div><label class="form-field">${simulated ? 'URI de ejemplo · simulación' : 'URI de MongoDB'}<input id="conn-uri" type="${simulated ? 'text' : 'password'}" autocomplete="off" spellcheck="false" ${simulated ? 'readonly value="mongodb://demo.invalid"' : ''} placeholder="${previous ? 'URI guardada · deja vacío para conservarla' : 'mongodb+srv://usuario:contraseña@cluster/…'}"><small>${simulated ? 'No se realiza una conexión de red. Las URI reales se ingresan en la aplicación local.' : 'Se guarda cifrada en el servidor. No tendrás que ingresarla de nuevo para reconectar.'}</small></label><div class="form-grid"><label class="form-field">Base de datos <span class="muted">(opcional)</span><input id="conn-database" placeholder="db_eventlog" value="${esc(previous?.database || '')}"></label><label class="form-field">Color de la conexión<select id="conn-color"><option value="red">Rojo Scotia</option><option value="teal">Verde</option><option value="blue">Azul</option><option value="violet">Violeta</option><option value="amber">Ámbar</option></select></label></div><label class="checkbox-label"><input id="conn-readonly" type="checkbox" ${previous?.readOnly ? 'checked' : ''}>Abrir como solo lectura</label><div class="info-box">${simulated ? 'El perfil ficticio se conserva en este navegador. Los documentos de ejemplo duran la sesión.' : 'Una conexión fallida no se agrega al listado. Desconectar conserva el perfil; Eliminar conexión lo borra.'}</div>`, `<button class="button" data-action="close-modal">Cancelar</button><button class="button primary" id="connect-submit">${simulated ? 'Simular conexión' : previous ? 'Guardar y conectar' : 'Probar y conectar'}</button>`);
  $('#conn-provider').value = previous?.provider || 'Atlas'; $('#conn-environment').value = previous?.environment || 'IST'; $('#conn-color').value = previous?.color || 'red';
  $('#connect-submit').onclick = async e => {
    const btn = e.currentTarget, label = btn.textContent, dialog = $('.modal'); btn.disabled = true; btn.textContent = 'Conectando…'; state.connecting = previous?.id || 'new'; renderConnections();
    try {
      const body = { name: $('#conn-name').value.trim(), provider: $('#conn-provider').value, environment: $('#conn-environment').value, database: $('#conn-database').value.trim(), readOnly: $('#conn-readonly').checked, color: $('#conn-color').value };
      if (!body.name) throw new Error('Ingresa un nombre para la conexión.');
      let connection;
      if (simulated) {
        connection = { ...body, id: previous?.id || crypto.randomUUID(), database: body.database || 'db_eventlog', status: 'connected', readOnly: body.readOnly || body.environment === 'PROD' };
        saveDemoConnections(state.connections.filter(c => c.id !== connection.id).concat(connection));
      } else {
        body.uri = $('#conn-uri').value;
        connection = await api(previous ? `connections/${encodeURIComponent(previous.id)}` : 'connections', body, previous ? 'PUT' : 'POST');
      }
      upsertProfile(connection);
      if ($('.modal') === dialog) { if ($('#conn-uri')) $('#conn-uri').value = ''; closeModal(); }
      await selectConnection(connection.id); toast(simulated ? 'Perfil de demo guardado. Conexión simulada.' : 'Conexión exitosa. Configuración guardada.');
    } catch (err) { if ($('.modal') === dialog) { $('#modal-error').textContent = err.message; btn.disabled = false; btn.textContent = label; } else toast(err.message); }
    finally { state.connecting = ''; renderConnections(); }
  };
}
function upsertProfile(connection) {
  const index = state.connections.findIndex(c => c.id === connection.id);
  if (index < 0) state.connections.push(connection); else state.connections[index] = connection;
}
async function connectProfile(id) {
  if (state.connecting) return;
  const profile = state.connections.find(c => c.id === id);
  if (!profile) return;
  state.connecting = id; state.error = ''; renderConnections(); renderWorkspace();
  try {
    const connection = state.mode === 'demo' ? { ...profile, status: 'connected' } : await api(`connections/${encodeURIComponent(id)}/connect`, {});
    upsertProfile(connection); state.connecting = ''; await selectConnection(id);
  } catch (error) {
    state.connecting = ''; await selectConnection(id); state.error = error.message; renderConnections(); renderWorkspace();
  }
}
async function disconnectProfile(id) {
  const profile = state.connections.find(c => c.id === id);
  if (!profile || state.connecting) return;
  state.connecting = id; renderConnections();
  try {
    upsertProfile(state.mode === 'demo' ? { ...profile, status: 'disconnected' } : await api(`connections/${encodeURIComponent(id)}/disconnect`, {}));
    if (state.connection === id) await selectConnection(id);
    toast('Desconectado. Tu conexión sigue guardada.');
  } finally { state.connecting = ''; renderConnections(); renderWorkspace(); }
}
function removeProfile(id) {
  if (state.connecting) return;
  const profile = state.connections.find(c => c.id === id); if (!profile) return;
  modal('Eliminar conexión guardada', profile.name, '<p>Se eliminarán el perfil y su configuración guardada. Los datos de MongoDB permanecen intactos.</p><p class="muted">Si solo quieres cerrar la conexión, utiliza Desconectar.</p>', '<button class="button" data-action="close-modal">Cancelar</button><button class="button primary" id="remove-profile-submit">Eliminar conexión</button>');
  $('#remove-profile-submit').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const remaining = state.connections.filter(c => c.id !== id);
      if (state.mode === 'demo') saveDemoConnections(remaining); else await api(`connections/${encodeURIComponent(id)}`, null, 'DELETE');
      state.connections = remaining; closeModal();
      if (state.connection === id) { resetResults(); state.connection = ''; state.databases = []; state.collections = []; state.database = ''; state.collection = ''; state.busy = false; }
      renderConnections(); renderWorkspace(); toast('Conexión eliminada del listado.');
    } catch (error) { $('#modal-error').textContent = error.message; btn.disabled = false; }
  };
}
function productionInput() { return state.mode === 'live' && current()?.environment === 'PROD' ? `<label class="form-field production-confirm">Confirma escribiendo el nombre de la colección: <strong>${esc(state.collection)}</strong><input id="confirm-production" autocomplete="off"></label>` : ''; }
function showDocument(action, index) {
  const doc = state.documents[index];
  if (action !== 'inspect' && !canWrite()) return;
  const editing = action === 'edit', inserting = action === 'insert', readonly = action === 'inspect';
  const target = { ...context(), mode: state.mode };
  const revision = state.revisions[index];
  const title = inserting ? 'Insertar documento' : editing ? 'Editar documento' : 'Documento completo';
  modal(title, `${state.database}.${state.collection} · ${current()?.name} · ${current()?.environment}`, `<div class="editor-note">${icon('code')}Extended JSON${readonly ? ' · Todos los campos' : ' · Conserva ObjectId, fechas y tipos numéricos BSON'}</div><textarea class="document-editor" id="document-editor" spellcheck="false" aria-label="Documento Extended JSON" ${readonly ? 'readonly' : ''}>${esc(pretty(inserting ? { eventType: 'TICKET_CREATED', status: 'SUCCESS', created_at: { $date: new Date().toISOString() }, eventData: {} } : doc))}</textarea>${readonly ? '' : productionInput()}${editing ? '<p class="editor-footnote">Se reemplaza el documento completo. El _id debe conservarse. Si cambió en el servidor, la operación se detendrá.</p>' : ''}`, `<button class="button" data-action="close-modal">${readonly ? 'Cerrar' : 'Cancelar'}</button>${readonly ? '<button class="button primary" id="copy-full">Copiar JSON</button>' : `<button class="button primary" id="write-submit">${inserting ? 'Insertar documento' : 'Guardar cambios'}</button>`}`, true);
  if (readonly) { $('#copy-full').onclick = () => copy(pretty(doc)); return; }
  $('#write-submit').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const body = { connection: target.connection, database: target.database, collection: target.collection, document: parseObject($('#document-editor').value, 'Documento'), ...(editing ? { id: doc._id, revision } : {}), confirmProduction: $('#confirm-production')?.value };
      if (target.mode === 'demo') demoWrite(inserting ? 'insert' : 'edit', body); else await api('documents', body, inserting ? 'POST' : 'PUT');
      closeModal(); toast(inserting ? 'Documento insertado.' : 'Documento actualizado.'); await Promise.all([runQuery(), metadata()]);
    } catch (err) { $('#modal-error').textContent = err.message; btn.disabled = false; }
  };
}
function showDelete(index) {
  if (!canWrite() || !state.revisions[index]) return;
  const doc = state.documents[index], target = { ...context(), id: doc._id, revision: state.revisions[index] }, mode = state.mode;
  modal('Eliminar documento', `${current().name} · ${current().environment} · ${state.database}.${state.collection}`, `<div class="delete-icon">${icon('trash')}</div><p>Se eliminará este documento de <strong>${esc(state.collection)}</strong>. Esta acción no se puede deshacer.</p><div class="id-box mono">${esc(idText(doc._id))}</div>${mode === 'demo' ? '<p class="muted">Estás eliminando un documento ficticio de esta sesión de demo.</p>' : ''}${productionInput()}`, '<button class="button" data-action="close-modal">Cancelar</button><button class="button primary" id="delete-submit">Eliminar documento</button>');
  $('#delete-submit').onclick = async e => { const btn = e.currentTarget; btn.disabled = true; try { const body = { ...target, confirmProduction: $('#confirm-production')?.value }; if (mode === 'demo') demoWrite('delete', body); else await api('documents', body, 'DELETE'); closeModal(); toast('Documento eliminado.'); await Promise.all([runQuery(false, true), metadata()]); } catch (err) { $('#modal-error').textContent = err.message; btn.disabled = false; } };
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Documento copiado.'); } catch { toast('El navegador no permitió copiar. Abre el documento para seleccionar el JSON.'); } }
function showSaved(history = false) {
  const list = history ? state.history : state.saved;
  modal(history ? 'Historial de consultas' : 'Consultas guardadas', 'Disponible durante esta sesión. No se guardan filtros en el navegador.', list.length ? `<div class="saved-list">${list.map((item, i) => `<button class="saved-item" data-load-query="${i}" data-history="${history}"><span>${icon(history ? 'history' : 'bookmark')}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.database)}.${esc(item.collection)} · ${item.mode === 'demo' ? 'Demo' : 'Real'}</small><code>${esc(JSON.stringify(item.filter))}</code></div>${icon('arrow')}</button>`).join('')}</div>` : `<div class="empty-results">${icon(history ? 'history' : 'bookmark')}<h3>${history ? 'Aún no hay consultas' : 'Tus consultas, a un clic'}</h3><p>Usa «Guardar consulta» en el editor para volver a tus filtros.</p></div>`);
}
function saveQuery() {
  captureInputs();
  let query; try { query = { ...context(), filter: parseObject(state.filter, 'Filtro'), sort: parseObject(state.sort, 'Orden'), projection: parseObject(state.projection, 'Proyección'), limit: state.limit, mode: state.mode }; } catch (e) { toast(e.message); return; }
  modal('Guardar consulta', 'Ponle un nombre para encontrarla fácilmente durante esta sesión.', `<label class="form-field">Nombre<input id="query-name" maxlength="80" placeholder="Errores de Event Log"></label><pre class="query-preview">${esc(pretty(query.filter))}</pre>`, '<button class="button" data-action="close-modal">Cancelar</button><button class="button primary" id="save-submit">Guardar consulta</button>');
  $('#save-submit').onclick = () => { const name = $('#query-name').value.trim(); if (!name) { $('#modal-error').textContent = 'Escribe un nombre.'; return; } state.saved.unshift({ name, ...query }); state.saved = state.saved.slice(0, 40); closeModal(); renderConnections(); toast('Consulta guardada en esta sesión.'); };
}
async function loadQuery(index, history) {
  const query = (history ? state.history : state.saved)[index];
  if (query.mode !== state.mode) { $('#modal-error').textContent = `Cambia primero al modo ${query.mode === 'demo' ? 'demostración' : 'real'}.`; return; }
  if (!state.connections.some(c => c.id === query.connection)) { $('#modal-error').textContent = 'La conexión original ya no está disponible.'; return; }
  closeModal();
  if (state.connections.find(c => c.id === query.connection)?.status !== 'connected') { await selectConnection(query.connection); toast('Conecta el perfil antes de ejecutar esta consulta.'); return; }
  if (query.connection !== state.connection) await selectConnection(query.connection);
  if (query.database !== state.database) await selectDatabase(query.database);
  if (!state.collections.includes(query.collection)) { toast('La colección original ya no está disponible.'); return; }
  state.collection = query.collection; state.tab = 'documents'; state.filter = pretty(query.filter); state.sort = JSON.stringify(query.sort); state.projection = JSON.stringify(query.projection); state.limit = query.limit; renderConnections(); renderWorkspace(); await Promise.all([runQuery(), metadata()]);
}
function settings() {
  modal('Configuración del workspace', 'Scotia Compass · v1.0', `<div class="setting-row"><span>Modo actual</span><strong>${state.mode === 'demo' ? 'Demostración' : 'Conexiones reales'}</strong></div><div class="setting-row"><span>Backend local</span><strong>${state.backend ? 'Disponible' : 'No disponible en esta vista'}</strong></div><div class="setting-row"><span>Autenticación</span><strong>${state.requiresAuth ? 'Clave de instancia' : state.backend ? 'Acceso local (loopback)' : 'Demo privada'}</strong></div><div class="setting-row"><span>Formato de documentos</span><strong>Extended JSON canónico</strong></div><div class="info-box">Crea los perfiles desde Nueva conexión. Se guardan después de conectar correctamente. Desconectar los conserva; Eliminar conexión los borra. Las URI reales se guardan cifradas en el servidor.</div><p class="muted">Esta versión es un workspace de operador único. Para un despliegue compartido, intégralo detrás de la autenticación corporativa.</p>`, `${state.auth && state.requiresAuth ? '<button class="button" data-action="logout">Cerrar sesión</button>' : ''}<button class="button primary" data-action="close-modal">Entendido</button>`);
}
function help() {
  modal('Un poco de orientación', 'Todo lo que necesitas para empezar a explorar.', `<div class="help-item">${icon('database')}<div><strong>1. Elige una conexión</strong><p>Usa Nueva conexión, personaliza el nombre y configura tu URI. Después de conectar, elige una base y una colección.</p></div></div><div class="help-item">${icon('code')}<div><strong>2. Consulta con JSON</strong><p>Usa filtros como <code>{ "status": "ERROR" }</code>. Para fechas: <code>{ "created_at": { "$gte": { "$date": "2026-11-01T00:00:00Z" } } }</code>. No se ejecuta JavaScript.</p></div></div><div class="help-item">${icon('edit')}<div><strong>3. Administra documentos</strong><p>Inserta, edita o elimina un documento por vez. Las ediciones usan el documento completo y conservan sus tipos BSON.</p></div></div><div class="shortcut-row"><span>Ejecutar consulta</span><kbd>Ctrl / ⌘ + Enter</kbd></div><div class="shortcut-row"><span>Buscar conexión</span><kbd>/</kbd></div><div class="shortcut-row"><span>Cerrar diálogo</span><kbd>Esc</kbd></div><p class="muted">El servidor debe alcanzar ambos MongoDB por la red. El progreso del pipeline se registra en SQL Server; esta consola explora documentos y no calcula el avance de la migración.</p>`);
}
function connectionDetails(id = state.connection) {
  const c = state.connections.find(c => c.id === id); if (!c) return;
  modal(c.name, `${c.provider} · ${c.environment}`, `<div class="setting-row"><span>Estado</span><strong>${c.status === 'connected' ? 'Conectada' : 'Desconectada'}</strong></div><div class="setting-row"><span>Acceso</span><strong>${c.readOnly ? 'Solo lectura' : 'Lectura y escritura'}</strong></div><div class="setting-row"><span>Configuración</span><strong>${state.mode === 'demo' ? 'Perfil ficticio en este navegador' : 'Guardada y cifrada en el servidor'}</strong></div><div class="info-box">Desconectar cierra el acceso a MongoDB y conserva tu configuración para volver a conectar. Eliminar conexión borra el perfil guardado.</div>`, `<button class="button danger-outline" data-action="remove-profile" data-profile="${esc(id)}">${icon('trash')}Eliminar</button><button class="button" data-action="edit-profile" data-profile="${esc(id)}">Editar</button><button class="button primary" data-action="${c.status === 'connected' ? 'disconnect-profile' : 'reconnect-profile'}" data-profile="${esc(id)}">${c.status === 'connected' ? 'Desconectar' : 'Conectar'}</button>`);
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button'); if (!target || target.disabled) return;
  try {
    if (target.dataset.connection) { $('#sidebar').classList.remove('open'); await selectConnection(target.dataset.connection); return; }
    if (target.dataset.database) { await selectDatabase(target.dataset.database); return; }
    if (target.dataset.collection) { await selectCollection(target.dataset.collection); return; }
    if (target.dataset.loadQuery !== undefined) { await loadQuery(Number(target.dataset.loadQuery), target.dataset.history === 'true'); return; }
    if (target.dataset.preset) { state.filter = target.dataset.preset === 'errors' ? '{ "status": "ERROR" }' : target.dataset.preset === 'today' ? pretty({ created_at: { $gte: { $date: new Date(Date.now() - 86400000).toISOString() } } }) : '{}'; $('#query-filter').value = state.filter; await runQuery(); return; }
    const action = target.dataset.action, index = Number(target.dataset.index);
    if (!action) return;
    if (action === 'theme') window.scotiaTheme.set(target.dataset.themeValue);
    else if (action === 'close-modal') closeModal();
    else if (action === 'menu') $('#sidebar').classList.toggle('open');
    else if (action === 'mode') showMode();
    else if (action === 'demo-mode') await switchMode('demo');
    else if (action === 'live-mode') await switchMode('live');
    else if (action === 'connect') showConnectionForm();
    else if (action === 'profile-details') connectionDetails(target.dataset.profile);
    else if (action === 'edit-profile') showConnectionForm(target.dataset.profile);
    else if (action === 'remove-profile') removeProfile(target.dataset.profile);
    else if (action === 'disconnect-profile') { closeModal(); await disconnectProfile(target.dataset.profile); }
    else if (action === 'reconnect-profile') { closeModal(); await connectProfile(target.dataset.profile); }
    else if (action === 'help') help();
    else if (action === 'settings') settings();
    else if (action === 'connection-details') connectionDetails();
    else if (action === 'run') await runQuery();
    else if (action === 'refresh') { if (state.collection) { await Promise.all([runQuery(false, true), metadata()]); } else await selectConnection(state.connection); }
    else if (action === 'advanced') { captureInputs(); state.advanced = !state.advanced; renderWorkspace(); }
    else if (action === 'reset') { state.filter = '{}'; state.sort = '{ "_id": 1 }'; state.projection = '{}'; state.limit = 20; renderWorkspace(); await runQuery(); }
    else if (action === 'json' || action === 'table') { captureInputs(); state.view = action; renderWorkspace(); }
    else if (['documents', 'indexes', 'schema', 'explorer'].includes(action)) { captureInputs(); state.tab = action === 'explorer' ? 'documents' : action; renderWorkspace(); }
    else if (['insert', 'edit', 'inspect'].includes(action)) showDocument(action, index);
    else if (action === 'delete') showDelete(index);
    else if (action === 'copy') await copy(pretty(state.documents[index]));
    else if (action === 'saved') showSaved();
    else if (action === 'history') showSaved(true);
    else if (action === 'save') saveQuery();
    else if (action === 'previous' || action === 'next') { state.skip = Math.max(0, state.skip + (action === 'next' ? 1 : -1) * state.limit); await runQuery(false, true); $('.results-toolbar')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if (action === 'logout') { await api('session', null, 'DELETE'); state.auth = false; await switchMode('demo'); toast('Sesión cerrada.'); }
    else if (action === 'export') { const blob = new Blob([pretty(state.documents)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${state.collection}-pagina-${Math.floor(state.skip / state.limit) + 1}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Página exportada en Extended JSON.'); }
  } catch (error) { if ($('#modal-error')) $('#modal-error').textContent = error.message; else toast(error.message); }
});
document.addEventListener('keydown', event => {
  const openModal = $('.modal');
  if (event.key === 'Escape' && openModal) closeModal();
  if (event.key === 'Tab' && openModal) {
    const elements = [...openModal.querySelectorAll('button:not(:disabled), input, select, textarea, a[href]')];
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !openModal && !state.busy && state.tab === 'documents') { event.preventDefault(); runQuery(); }
  if (event.key === '/' && !openModal && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); $('#search-connections').focus(); }
});

shell();
try {
  const meta = await api('meta'); state.backend = meta.available; state.requiresAuth = meta.requiresAuth; state.auth = meta.authenticated;
  state.mode = 'live';
  if (meta.authenticated) state.connections = await api('connections');
} catch { /* Static publication intentionally provides a browser-only demonstration. */ }
if (state.mode === 'demo') state.connections = loadDemoConnections();
state.ready = true; renderConnections(); renderWorkspace();
