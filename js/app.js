// Vertikal CRM · aplicación principal
import { $, $$, esc, icon, uid, todayStr, ymd, ym, parseYmd, addDays, monthAdd, monthName, fmtDate, fmtLongDate, fmtDateTime, fmtTime, fmtHM, relTime, debounce, linkInfo, typeIcon, mimeToType, fmtSize } from './util.js';
import * as S from './store.js';
import { store, STATUS, BOARD_STATUSES, PRIORITY, CLIENT_COLORS } from './store.js';
import { auth, signIn, signOut, uploadFile, driveMeta, listEvents, createEvent, listEventsRange, exportToSheet, archiveLoad } from './google.js';
import { syncAll, scheduleSync, syncState, onSync } from './sync.js';

const CFG = window.VK_CONFIG || {};
const TZ = CFG.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

const NAV = [
  { id: 'dashboard', label: 'Inicio', icon: 'dashboard' },
  { id: 'week', label: 'Semana', icon: 'week' },
  { id: 'tasks', label: 'Tareas', icon: 'tasks' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'recurring', label: 'Recurrentes', icon: 'repeat' },
  { id: 'clients', label: 'Clientes', icon: 'clients' },
  { id: 'agenda', label: 'Agenda', icon: 'calendar' },
  { id: 'stats', label: 'Estadísticas', icon: 'chart' },
  { id: 'archive', label: 'Archivo', icon: 'archive' },
  { id: 'settings', label: 'Ajustes', icon: 'settings' }
];
const MOBILE_NAV = ['dashboard', 'week', 'tasks', 'inbox'];
const TITLES = { dashboard: 'Dashboard', week: 'Mi semana', tasks: 'Tareas', inbox: 'Inbox', recurring: 'Tareas recurrentes', clients: 'Clientes', agenda: 'Agenda', stats: 'Estadísticas', archive: 'Archivo', settings: 'Ajustes' };

const ui = {
  route: 'dashboard', params: {}, openId: null,
  f: { st: 'active', client: '', cat: '', period: 'all', q: '', view: localStorage.getItem('vkcrm.view') || 'list' },
  events: [], eventsAt: 0, eventsErr: null, uploads: {},
  weekStart: null, weekEvents: {}, statsPeriod: 'month', archF: { client: '', cat: '', q: '' }, archOpen: null
};

// ---------------------------------------------------------------- helpers de UI
const cColor = id => S.getClient(id)?.color || 'var(--outline)';
const clientChip = (id, cls = '') => `<span class="cchip ${cls}"><i class="cdot" style="background:${esc(cColor(id))}"></i><span class="n">${esc(S.clientName(id))}</span></span>`;
const statusBtn = (t, act = true) => `<button class="status st-${t.status}" ${act ? `data-act="status-menu" data-id="${t.id}"` : 'tabindex="-1"'}>${icon(STATUS[t.status].icon)}${STATUS[t.status].label}</button>`;
const prioIcon = p => `<span class="prio-${p}" title="Prioridad ${PRIORITY[p]}">${p === 'normal' ? '' : icon('flag', 'sm')}</span>`;
const dueLabel = t => {
  if (t.status === 'done') return t.completedAt ? `<span class="muted">${fmtDate(ymd(new Date(t.completedAt)), false)} · ${fmtTime(new Date(t.completedAt))}</span>` : '';
  if (!t.dueDate) return '<span class="muted">Sin fecha</span>';
  return `${fmtDate(t.dueDate)}${t.dueTime ? ' · ' + fmtHM(t.dueTime) : ''}`;
};
const metaIcons = t => {
  const out = [];
  if (t.subtasks.length) out.push(`<span title="Subtareas">${icon('subtask', 'xs')}${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}</span>`);
  const n = t.links.length + t.files.length; if (n) out.push(`<span title="Enlaces y archivos">${icon('attach', 'xs')}${n}</span>`);
  if (t.source === 'recurring') out.push(`<span title="Recurrente">${icon('repeat', 'xs')}</span>`);
  if (t.source === 'gmail') out.push(`<span title="Desde Gmail">${icon('mail', 'xs')}</span>`);
  if (t.gtaskId) out.push(`<span title="En Google Tasks (widget)">${icon('gtasks', 'xs')}</span>`);
  if (t.carriedFrom && t.status !== 'done') out.push(`<span class="carry" title="Pendiente desde ${S.monthLabel(t.carriedFrom)}">De ${S.monthLabel(t.carriedFrom).slice(0, 3)}</span>`);
  return out.length ? `<span class="meta-icons">${out.join('')}</span>` : '';
};

const grip = on => on ? `<span class="grip" data-grip title="Arrastra para ordenar">${icon('grip', 'sm')}</span>` : '<span class="grip off"></span>';
function taskRow(t, sortable = false) {
  const done = t.status === 'done', over = S.isOverdue(t);
  return `<div class="trow ${done ? 'is-done' : ''} ${over ? 'is-over' : ''}" data-act="open" data-id="${t.id}" draggable="false">
    ${grip(sortable && !done)}
    <button class="check ${done ? 'on' : ''}" data-act="toggle" data-id="${t.id}" aria-label="Completar">${icon('check')}</button>
    <span class="code col-code">${esc(t.code)}</span>
    <div class="tcell"><div class="ttitle"><span class="t">${esc(t.title)}</span>${metaIcons(t)}</div>
      <div class="mob-meta"><i class="cdot" style="background:${esc(cColor(t.clientId))}"></i>${esc(S.clientName(t.clientId))}${t.status !== 'pending' && !done ? ' · ' + STATUS[t.status].label : ''}</div></div>
    ${clientChip(t.clientId, 'col-client')}
    <span class="col-cat">${t.categoryId ? `<span class="tag">${esc(S.categoryName(t.categoryId))}</span>` : ''}</span>
    <span class="col-prio">${prioIcon(t.priority)}</span>
    <span class="col-status">${statusBtn(t)}</span>
    <span class="tdue">${dueLabel(t)}</span>
    <button class="icon-btn sm col-more" data-act="row-menu" data-id="${t.id}" aria-label="Más">${icon('more')}</button>
  </div>`;
}
function compactRow(t, sortable = false) {
  const done = t.status === 'done', over = S.isOverdue(t);
  return `<div class="trow ${done ? 'is-done' : ''} ${over ? 'is-over' : ''}" data-act="open" data-id="${t.id}">
    ${grip(sortable && !done)}
    <button class="check ${done ? 'on' : ''}" data-act="toggle" data-id="${t.id}" aria-label="Completar">${icon('check')}</button>
    <div class="tcell"><div class="ttitle"><span class="t">${esc(t.title)}</span>${metaIcons(t)}</div>
      <div class="cmeta"><i class="cdot" style="background:${esc(cColor(t.clientId))}"></i>${esc(S.clientName(t.clientId))}${t.categoryId ? ' · ' + esc(S.categoryName(t.categoryId)) : ''}${t.priority === 'high' ? ' · <b class="prio-high">Alta</b>' : ''}</div></div>
    ${statusBtn(t)}
    <span class="tdue">${dueLabel(t)}</span>
  </div>`;
}
const listHead = () => `<div class="trow thead"><span class="grip off"></span><span></span><span class="col-code">Cód.</span><span>Tarea</span><span class="col-client">Cliente</span><span class="col-cat">Categoría</span><span class="col-prio"></span><span class="col-status">Estado</span><span>Fecha</span><span class="col-more"></span></div>`;
const emptyBox = (txt, ic = 'check', big = false) => `<div class="empty ${big ? 'big' : ''}">${icon(ic)}${txt}</div>`;
const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
const clientOptions = (sel, none = 'Sin cliente') => opt('', none, sel) + S.clients().map(c => opt(c.id, c.name, sel)).join('') + (sel && S.getClient(sel)?.archived ? opt(sel, S.clientName(sel) + ' (archivado)', sel) : '');
const catOptions = (sel, none = 'Sin categoría') => opt('', none, sel) + S.categories().map(c => opt(c.id, c.name, sel)).join('');
const prioOptions = sel => Object.entries(PRIORITY).map(([k, v]) => opt(k, v, sel)).join('');
const statusOptions = (sel, withInbox = false) => Object.entries(STATUS).filter(([k]) => withInbox || k !== 'inbox').map(([k, v]) => opt(k, v.label, sel)).join('');

// ---------------------------------------------------------------- navegación
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs] = h.split('?');
  const parts = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  if (parts[0] === 'task' && parts[1]) { ui.openId = parts[1]; ui.route = ui.route && ui.route !== 'task' ? ui.route : 'tasks'; history.replaceState(null, '', '#/' + ui.route); }
  else ui.route = NAV.some(n => n.id === parts[0]) ? parts[0] : 'dashboard';
  ui.params = params;
  ui.archOpen = ui.route === 'archive' && parts[1] ? parts[1] : null;
  if (ui.route === 'tasks' && params.f) { ui.f.st = params.f; }
  if (ui.route === 'tasks' && params.client) { ui.f.client = params.client; }
  if (params.new) setTimeout(() => taskDialog(), 50);
}

function renderNav() {
  const over = S.tasks().filter(t => S.isOverdue(t)).length;
  const inbox = S.tasks().filter(t => t.status === 'inbox').length;
  const badge = id => id === 'inbox' && inbox ? `<span class="badge">${inbox}</span>` : id === 'tasks' && over ? `<span class="badge">${over}</span>` : '';
  $('#navItems').innerHTML = NAV.map(n => `<a class="rail-item ${ui.route === n.id ? 'active' : ''}" href="#/${n.id}"><span class="pill">${icon(n.icon)}${badge(n.id)}</span>${n.label}</a>`).join('');
  const more = !MOBILE_NAV.includes(ui.route);
  $('#bottomNav').innerHTML = MOBILE_NAV.map(id => { const n = NAV.find(x => x.id === id); return `<a class="bn-item ${ui.route === id ? 'active' : ''}" href="#/${id}"><span class="pill">${icon(n.icon)}${badge(id)}</span>${n.label}</a>`; }).join('')
    + `<a class="bn-item ${more ? 'active' : ''}" href="#" data-act="more-nav"><span class="pill">${icon('more')}</span>Más</a>`;
  $('#viewTitle').textContent = TITLES[ui.route];
  document.title = `${TITLES[ui.route]} · Vertikal CRM`;
}

function render() {
  renderNav();
  const view = VIEWS[ui.route] || VIEWS.dashboard;
  $('#view').innerHTML = view();
  afterRender();
  if (ui.openId) renderSheet(); else if (ui.archTask) renderArchSheet(); else closeSheet(false);
  renderAccount();
}

// ---------------------------------------------------------------- DASHBOARD
function viewDashboard() {
  const all = S.tasks();
  const today = todayStr();
  const todayOpen = all.filter(t => S.isOpen(t) && t.dueDate === today && !S.isOverdue(t)).sort(S.orderCmp);
  const doneToday = all.filter(t => S.doneOn(t, today)).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const over = all.filter(t => S.isOverdue(t)).sort(S.orderCmp);
  const prog = all.filter(t => t.status === 'progress' || t.status === 'following').sort(S.orderCmp);
  const inbox = all.filter(t => t.status === 'inbox');
  const monthDone = all.filter(t => t.status === 'done' && t.completedAt && ym(new Date(t.completedAt)) === ym(new Date())).length;
  const h = new Date().getHours();
  const greet = h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches';
  if (auth.valid && Date.now() - ui.eventsAt > 5 * 60e3) loadEvents();

  return `${archiveBanner()}
  <div class="hero">
    <div><h2>${greet}, ${esc(CFG.USER_NAME || '')}</h2><p>${fmtLongDate(new Date())} · ${todayOpen.length + over.length} pendientes para hoy</p></div>
    <div class="toolbar" style="margin:0">
      <button class="btn outlined" data-act="meet-new">${icon('video', 'sm')}Agendar reunión</button>
      <button class="btn tonal" data-act="inbox-capture">${icon('inbox', 'sm')}Capturar en Inbox</button>
    </div>
  </div>
  <div class="kpis" style="margin-bottom:12px">
    <button class="kpi k-today" data-go="#/tasks?f=today"><span class="lbl">${icon('clock', 'sm')}Para hoy</span><span class="val">${todayOpen.length}</span><span class="sub">${doneToday.length} terminadas hoy</span></button>
    <button class="kpi k-over" data-go="#/tasks?f=overdue"><span class="lbl">${icon('alert', 'sm')}Atrasadas</span><span class="val">${over.length}</span><span class="sub">${over.length ? 'Requieren atención' : 'Todo al día'}</span></button>
    <button class="kpi k-prog" data-go="#/tasks?f=progress"><span class="lbl">${icon('progress', 'sm')}En desarrollo</span><span class="val">${all.filter(t => t.status === 'progress').length}</span><span class="sub">${all.filter(t => t.status === 'following').length} en seguimiento</span></button>
    <button class="kpi k-inbox" data-go="#/inbox"><span class="lbl">${icon('inbox', 'sm')}Inbox</span><span class="val">${inbox.length}</span><span class="sub">Por clasificar</span></button>
    <button class="kpi k-done" data-go="#/tasks?f=done"><span class="lbl">${icon('done', 'sm')}Terminadas</span><span class="val">${monthDone}</span><span class="sub">En ${monthName(ym(new Date()))}</span></button>
  </div>
  <div class="grid dash">
    <section class="card span-7">
      <div class="card-h"><h3>${icon('clock', 'sm')}Hoy</h3><span class="count">${todayOpen.length}</span><span class="sp"></span><a class="btn text sm" href="#/tasks?f=today">Ver todo</a></div>
      <div class="tlist compact"><div data-sort>${todayOpen.map(t => compactRow(t, true)).join('')}</div>${todayOpen.length ? '' : emptyBox('Nada pendiente para hoy')}
      ${doneToday.length ? `<div class="section-title">Terminadas hoy<span class="sp"></span></div>${doneToday.map(t => compactRow(t)).join('')}` : ''}</div>
    </section>
    <section class="card span-5">
      <div class="card-h"><h3 style="color:var(--error)">${icon('alert', 'sm')}Atrasadas</h3><span class="count">${over.length}</span></div>
      <div class="tlist compact" data-sort>${over.map(t => compactRow(t, true)).join('') || emptyBox('¡Excelente! No hay tareas atrasadas')}</div>
    </section>
    <section class="card span-4">
      <div class="card-h"><h3>${icon('calendar', 'sm')}Próximas reuniones</h3><span class="sp"></span><button class="icon-btn sm" data-act="meet-new" title="Nueva reunión">${icon('plus')}</button></div>
      ${eventsBlock(4, 6)}
    </section>
    <section class="card span-4">
      <div class="card-h"><h3>${icon('done', 'sm')}Terminadas · 14 días</h3></div>
      ${doneChart()}
    </section>
    <section class="card span-4">
      <div class="card-h"><h3>${icon('clients', 'sm')}Carga por cliente</h3></div>
      ${clientLoad()}
    </section>
    <section class="card span-7">
      <div class="card-h"><h3>${icon('progress', 'sm')}En desarrollo y seguimiento</h3><span class="count">${prog.length}</span></div>
      <div class="tlist compact" data-sort>${prog.map(t => compactRow(t, true)).join('') || emptyBox('Sin tareas en desarrollo', 'progress')}</div>
    </section>
    <section class="card span-5">
      <div class="card-h"><h3>${icon('link', 'sm')}Accesos rápidos</h3><span class="sp"></span><button class="icon-btn sm" data-act="quick-add" title="Agregar acceso">${icon('plus')}</button></div>
      ${quickBlock()}
    </section>
  </div>`;
}
const byDue = (a, b) => (S.dueMs(a) ?? 9e15) - (S.dueMs(b) ?? 9e15) || (a.priority === 'high' ? -1 : 0);

function doneChart() {
  const days = [...Array(14)].map((_, i) => ymd(addDays(new Date(), i - 13)));
  const counts = days.map(d => S.tasks().filter(t => S.doneOn(t, d)).length);
  const max = Math.max(4, ...counts);
  const W = 320, H = 150, pb = 20, pt = 10, bw = 14, gap = (W - 24 - bw * 14) / 13;
  const y = v => H - pb - (v / max) * (H - pb - pt);
  const bar = (x, v) => { const top = y(v), h = H - pb - top; if (h <= 0) return ''; const r = Math.min(4, h); return `M${x},${H - pb}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${H - pb}Z`; };
  const total = counts.reduce((a, b) => a + b, 0);
  const grid = [0, .5, 1].map(f => { const v = Math.round(max * f), yy = y(v); return `<line class="grid-l" x1="22" x2="${W}" y1="${yy}" y2="${yy}"/><text x="0" y="${yy + 3}">${v}</text>`; }).join('');
  const bars = days.map((d, i) => { const x = 24 + i * (bw + gap); const dd = parseYmd(d); return `<path class="bar ${i === 13 ? 'today' : ''}" d="${bar(x, counts[i]) || `M${x},${H - pb - 1}h${bw}v1h-${bw}z`}" data-tip="${fmtDate(d)}: ${counts[i]} terminada${counts[i] === 1 ? '' : 's'}"/>${i % 2 === 1 || i === 13 ? `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${dd.getDate()}</text>` : ''}<rect x="${x - gap / 2}" y="0" width="${bw + gap}" height="${H - pb}" fill="transparent" data-tip="${fmtDate(d)}: ${counts[i]} terminada${counts[i] === 1 ? '' : 's'}"/>`; }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tareas terminadas por día, últimos 14 días">${grid}${bars}</svg>
    <div class="legend"><span><b style="color:var(--on-surface)">${total}</b>&nbsp;terminadas en 14 días</span><span>Promedio ${(total / 14).toFixed(1)}/día</span></div>`;
}
function clientLoad() {
  const open = S.tasks().filter(S.isOpen);
  const rows = S.clients().map(c => ({ c, n: open.filter(t => t.clientId === c.id).length, o: open.filter(t => t.clientId === c.id && S.isOverdue(t)).length })).filter(r => r.n).sort((a, b) => b.n - a.n).slice(0, 7);
  if (!rows.length) return emptyBox('Sin tareas abiertas', 'clients');
  const max = Math.max(...rows.map(r => r.n));
  return `<div class="hbars">${rows.map(r => `<div class="hbar" data-go="#/tasks?f=active&client=${r.c.id}" data-tip="${esc(r.c.name)}: ${r.n} abiertas${r.o ? `, ${r.o} atrasadas` : ''}"><span class="cchip"><i class="cdot" style="background:${esc(r.c.color)}"></i><span class="n">${esc(r.c.name)}</span></span><span class="track">${r.o ? `<span class="fill over" style="width:${r.o / max * 100}%"></span>` : ''}${r.n - r.o ? `<span class="fill" style="width:${(r.n - r.o) / max * 100}%"></span>` : ''}</span><b>${r.n}</b></div>`).join('')}</div>
  <div class="legend"><span><i style="background:var(--brand-blue)"></i>Abiertas</span><span><i style="background:var(--error)"></i>Atrasadas</span></div>`;
}
function quickBlock() {
  const q = S.alive(store.state.quick);
  if (!q.length) return emptyBox('Agrega enlaces a tus archivos frecuentes', 'link');
  return `<div class="quick-list">${q.map(x => `<div class="quick ${x.url ? '' : 'nolink'}">
    <span class="ficon f-${x.type}">${icon(typeIcon(x.type))}</span>
    ${x.url ? `<a class="qt" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : `<span class="qt" title="${esc(x.hint || 'Sin enlace')}">${esc(x.title)}</span>`}
    <button class="icon-btn sm" data-act="quick-edit" data-id="${x.id}" title="Editar">${icon('edit', 'sm')}</button></div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- Eventos de Calendar
async function loadEvents(force = false) {
  if (!auth.valid || (!force && ui.eventsLoading)) return;
  ui.eventsLoading = true;
  try { ui.events = await listEvents(14); ui.eventsErr = null; }
  catch (e) { ui.eventsErr = e.message; }
  ui.eventsAt = Date.now(); ui.eventsLoading = false;
  if (ui.route === 'dashboard' || ui.route === 'agenda') { $('#view').innerHTML = VIEWS[ui.route](); afterRender(); }
}
const evStart = e => e.start.dateTime ? new Date(e.start.dateTime) : parseYmd(e.start.date);
function eventRow(e) {
  const st = evStart(e);
  const when = e.start.dateTime ? fmtTime(st) : 'Todo el día';
  const meet = e.hangoutLink || e.conferenceData?.entryPoints?.find(x => x.entryPointType === 'video')?.uri;
  return `<div class="ev"><span class="when">${when}</span><div class="what"><b>${esc(e.summary || '(Sin título)')}</b><small>${e.attendees?.length ? e.attendees.length + ' invitados' : ''}${e.location ? ' · ' + esc(e.location) : ''}</small></div>
    ${meet ? `<a class="icon-btn sm" href="${esc(meet)}" target="_blank" rel="noopener" title="Unirse a Meet">${icon('video', 'sm')}</a>` : ''}
    <a class="icon-btn sm" href="${esc(e.htmlLink)}" target="_blank" rel="noopener" title="Abrir en Calendar">${icon('open', 'sm')}</a></div>`;
}
function eventsBlock(days, max) {
  if (!auth.linked) return `<div class="empty">${icon('calendar')}Conecta tu cuenta de Google para ver tu agenda<br><button class="btn tonal sm" style="margin-top:8px" data-act="connect">Conectar Google</button></div>`;
  if (!auth.valid) return `<div class="empty">${icon('calendar')}La sesión expiró<br><button class="btn tonal sm" style="margin-top:8px" data-act="reconnect">Reconectar</button></div>`;
  if (ui.eventsErr) return `<div class="empty">${icon('alert')}${esc(ui.eventsErr)}</div>`;
  if (!ui.eventsAt) return emptyBox('Cargando agenda…', 'sync');
  const lim = ymd(addDays(new Date(), days));
  const evs = ui.events.filter(e => ymd(evStart(e)) < lim && (!e.end?.dateTime || new Date(e.end.dateTime) > new Date())).slice(0, max);
  if (!evs.length) return emptyBox('Sin reuniones próximas', 'calendar');
  let last = '', out = '';
  for (const e of evs) { const d = ymd(evStart(e)); if (d !== last) { out += `<div class="day-h">${fmtDate(d)}</div>`; last = d; } out += eventRow(e); }
  return out;
}

// ---------------------------------------------------------------- TAREAS
const FILTERS = [
  ['active', 'Activas'], ['today', 'Hoy'], ['overdue', 'Atrasadas'], ['pending', 'Pendientes'], ['progress', 'En desarrollo'], ['following', 'Seguimiento'], ['done', 'Terminadas'], ['all', 'Todas']
];
function filterTasks(st = ui.f.st) {
  const q = ui.f.q.trim().toLowerCase();
  const today = todayStr();
  let arr = S.tasks().filter(t => t.status !== 'inbox' || st === 'all');
  if (st === 'active') arr = arr.filter(S.isOpen);
  else if (st === 'today') arr = arr.filter(t => (S.isOpen(t) && t.dueDate && t.dueDate <= today) || S.doneOn(t, today));
  else if (st === 'overdue') arr = arr.filter(t => S.isOverdue(t));
  else if (st !== 'all') arr = arr.filter(t => t.status === st);
  if (ui.f.client) arr = arr.filter(t => t.clientId === ui.f.client);
  if (ui.f.cat) arr = arr.filter(t => t.categoryId === ui.f.cat);
  if (ui.f.period !== 'all') {
    const ref = t => t.status === 'done' && t.completedAt ? ymd(new Date(t.completedAt)) : t.dueDate || t.createdAt.slice(0, 10);
    if (ui.f.period === 'week') { const a = ymd(addDays(new Date(), -7)), b = ymd(addDays(new Date(), 7)); arr = arr.filter(t => ref(t) >= a && ref(t) <= b); }
    else arr = arr.filter(t => ref(t).startsWith(ui.f.period));
  }
  if (q) arr = arr.filter(t => [t.title, t.code, t.notes, S.clientName(t.clientId), S.categoryName(t.categoryId), ...t.subtasks.map(s => s.title)].join(' ').toLowerCase().includes(q));
  return arr;
}
function groupTasks(arr) {
  const today = todayStr(), tom = ymd(addDays(new Date(), 1)), wk = ymd(addDays(new Date(), 7));
  const open = arr.filter(t => t.status !== 'done').sort(S.orderCmp);
  const done = arr.filter(t => t.status === 'done').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  const G = [['Atrasadas', t => S.isOverdue(t)], ['Hoy', t => t.dueDate === today], ['Mañana', t => t.dueDate === tom], ['Próximos 7 días', t => t.dueDate && t.dueDate <= wk], ['Más adelante', t => !!t.dueDate], ['Sin fecha', () => true]];
  const used = new Set(), groups = [];
  for (const [name, fn] of G) { const g = open.filter(t => !used.has(t.id) && fn(t)); g.forEach(t => used.add(t.id)); if (g.length) groups.push([name, g]); }
  if (done.length) groups.push(['Terminadas', done]);
  return groups;
}
function viewTasks() {
  const arr = filterTasks();
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, filterTasks(k).length]));
  const months = [...new Set(S.tasks().map(t => (t.dueDate || t.createdAt).slice(0, 7)))].sort().reverse();
  const body = ui.f.view === 'board' ? boardHtml(arr) : (() => {
    const groups = groupTasks(arr);
    if (!groups.length) return `<div class="card">${emptyBox('No hay tareas con estos filtros', 'tasks', true)}</div>`;
    return `<div class="card" style="padding:8px 10px">${listHead()}${groups.map(([g, list]) => `<div class="section-title" ${g === 'Atrasadas' ? 'style="color:var(--error)"' : ''}>${g} · ${list.length}<span class="sp"></span></div><div class="tlist" ${g === 'Terminadas' ? '' : 'data-sort'}>${list.map(t => taskRow(t, g !== 'Terminadas')).join('')}</div>`).join('')}</div>`;
  })();
  return `
  <div class="toolbar">
    <div class="seg-scroll"><div class="seg" role="tablist">${FILTERS.map(([k, l]) => `<button class="${ui.f.st === k ? 'on' : ''}" data-act="filter-st" data-v="${k}">${l}<span class="n">${counts[k]}</span></button>`).join('')}</div></div>
  </div>
  <div class="toolbar">
    <select class="select mini" data-ch="filter" data-k="client" style="width:auto">${clientOptions(ui.f.client, 'Todos los clientes')}</select>
    <select class="select mini" data-ch="filter" data-k="cat" style="width:auto">${catOptions(ui.f.cat, 'Todas las categorías')}</select>
    <select class="select mini" data-ch="filter" data-k="period" style="width:auto">${opt('all', 'Cualquier fecha', ui.f.period)}${opt('week', '± 7 días', ui.f.period)}${months.map(m => opt(m, monthName(m), ui.f.period)).join('')}</select>
    ${ui.f.q ? `<button class="btn tonal sm" data-act="clear-q">“${esc(ui.f.q)}” ${icon('close', 'xs')}</button>` : ''}
    ${(ui.f.client || ui.f.cat || ui.f.period !== 'all') ? `<button class="btn text sm" data-act="clear-filters">Limpiar filtros</button>` : ''}
    <span class="sp"></span>
    <div class="seg"><button class="${ui.f.view === 'list' ? 'on' : ''}" data-act="view" data-v="list">${icon('list', 'sm')}Lista</button><button class="${ui.f.view === 'board' ? 'on' : ''}" data-act="view" data-v="board">${icon('board', 'sm')}Tablero</button></div>
  </div>
  ${body}`;
}
function boardHtml(arr) {
  return `<div class="board">${BOARD_STATUSES.map(st => {
    let list = arr.filter(t => t.status === st);
    list = st === 'done' ? list.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).slice(0, 40) : list.sort(S.orderCmp);
    return `<div class="col" data-drop="${st}"><div class="col-h"><span class="status st-${st}" style="cursor:default">${icon(STATUS[st].icon)}${STATUS[st].label}</span><span class="count">${list.length}</span></div>
      ${list.map(t => `<div class="kcard" data-gdrag="${t.id}" data-act="open" data-id="${t.id}" style="border-left-color:${esc(cColor(t.clientId))}">
        <div class="kt"><span class="grip" data-ghost title="Arrastra para mover">${icon('grip', 'sm')}</span>${t.priority === 'high' ? `<span class="prio-high">${icon('flag', 'xs')}</span> ` : ''}${esc(t.title)}</div>
        <div class="km">${clientChip(t.clientId)}<span class="tdue ${S.isOverdue(t) ? 'over-pill' : 'muted'}">${dueLabel(t)}</span></div>
        ${metaIcons(t) ? `<div class="km">${metaIcons(t)}<span class="code">${esc(t.code)}</span></div>` : ''}
      </div>`).join('') || `<div class="empty small">Arrastra tareas aquí</div>`}</div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- INBOX
function viewInbox() {
  const list = S.tasks().filter(t => t.status === 'inbox').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `
  <form class="capture" data-form="capture"><input class="input" name="title" placeholder="Captura rápida: escribe y presiona Enter para enviarla al Inbox" autocomplete="off" ${ui.params.focus ? 'autofocus' : ''}><button class="btn filled">${icon('plus', 'sm')}Capturar</button></form>
  <div class="banner" style="background:var(--surface-2);color:var(--on-surface)">${icon('gtasks')}<div class="t"><b>Envía tareas desde Google Tasks</b><span>Crea una tarea en la lista “${esc(CFG.GTASKS_LIST_NAME || 'Vertikal CRM')}” desde tu teléfono y aparecerá aquí para asignarle cliente, fecha y detalles.</span></div></div>
  <div class="card" style="padding:6px">
  ${list.length ? list.map(t => `<div class="ibx" data-id="${t.id}">
      <div class="tt"><b data-act="open" data-id="${t.id}">${esc(t.title)}</b><small>Ingresó ${fmtDateTime(t.createdAt)} · ${t.source === 'gtasks' ? 'desde Google Tasks' : t.source === 'gmail' ? 'desde Gmail' : 'captura manual'}</small></div>
      <select class="select mini" data-ch="tf" data-id="${t.id}" data-k="clientId">${clientOptions(t.clientId, 'Cliente…')}</select>
      <select class="select mini" data-ch="tf" data-id="${t.id}" data-k="categoryId">${catOptions(t.categoryId, 'Categoría…')}</select>
      <input class="input mini" type="date" data-ch="tf" data-id="${t.id}" data-k="dueDate" value="${esc(t.dueDate)}">
      <input class="input mini" type="time" data-ch="tf" data-id="${t.id}" data-k="dueTime" value="${esc(t.dueTime)}">
      <select class="select mini" data-ch="tf" data-id="${t.id}" data-k="priority">${prioOptions(t.priority)}</select>
      <div style="display:flex;gap:4px"><button class="btn filled sm" data-act="ibx-move" data-id="${t.id}">${icon('arrow', 'sm')}Mover</button><button class="icon-btn sm danger" data-act="del" data-id="${t.id}" title="Eliminar">${icon('trash', 'sm')}</button></div>
    </div>`).join('') : emptyBox('Inbox vacío. Todo está clasificado.', 'inbox', true)}
  </div>`;
}

// ---------------------------------------------------------------- RECURRENTES
function viewRecurring() {
  const list = S.alive(store.state.recurring).sort((a, b) => S.clientName(a.clientId).localeCompare(S.clientName(b.clientId)) || a.title.localeCompare(b.title));
  const nx = S.nextRecurringRun();
  const gen = Object.keys(store.state.settings.recurringGenerated || {}).sort().reverse();
  const perMonth = list.filter(r => r.active).reduce((a, r) => a + r.days.length, 0);
  const cur = ym(new Date());
  return `
  <div class="banner">${icon('repeat')}<div class="t"><b>Próxima generación: ${fmtLongDate(nx.date)}</b><span>El último día de cada mes se crean automáticamente las tareas de ${monthName(nx.month)} (${perMonth} tareas de ${list.filter(r => r.active).length} plantillas activas).</span></div>
    <select class="select mini" id="genMonth" style="width:auto;background-color:#fff;color:#000A4F">${[0, 1, 2].map(i => monthAdd(cur, i)).map(m => opt(m, monthName(m) + (store.state.settings.recurringGenerated?.[m] ? ' ✓' : ''), nx.month)).join('')}</select>
    <button class="btn filled sm" data-act="rec-gen" style="background:#fff;color:#000A4F">Generar ahora</button></div>
  <div class="toolbar"><span class="muted small">Meses generados: ${gen.map(m => monthName(m, false)).join(', ') || 'ninguno'}</span><span class="sp"></span><button class="btn filled" data-act="rec-new">${icon('plus', 'sm')}Nueva recurrente</button></div>
  <div class="card" style="padding:6px 8px">
    <div class="rec-row thead"><span>Activa</span><span>Tarea</span><span class="r-hide">Cliente</span><span class="r-hide">Categoría</span><span class="r-hide">Días del mes</span><span class="r-hide">Hora</span><span></span></div>
    ${list.map(r => `<div class="rec-row ${r.active ? '' : 'off'}">
      <button class="switch ${r.active ? 'on' : ''}" data-act="rec-toggle" data-id="${r.id}" aria-label="Activar"></button>
      <div><b style="font-weight:600">${esc(r.title)}</b><div class="small muted">${r.days.length}× al mes${r.priority === 'high' ? ' · Alta' : ''}</div></div>
      <span class="r-hide">${clientChip(r.clientId)}</span>
      <span class="r-hide"><span class="tag">${esc(S.categoryName(r.categoryId) || '—')}</span></span>
      <span class="r-hide daychips">${r.days.map(d => `<span>${d === 'L' ? 'Últ.' : d}</span>`).join('')}</span>
      <span class="r-hide small">${r.time ? fmtHM(r.time) : '—'}</span>
      <div style="display:flex;gap:2px;justify-content:flex-end"><button class="icon-btn sm" data-act="rec-edit" data-id="${r.id}" title="Editar">${icon('edit', 'sm')}</button><button class="icon-btn sm" data-act="rec-more" data-id="${r.id}" title="Más">${icon('more', 'sm')}</button></div>
    </div>`).join('') || emptyBox('Sin tareas recurrentes', 'repeat', true)}
  </div>`;
}

// ---------------------------------------------------------------- CLIENTES
function viewClients() {
  const showArch = ui.params.arch === '1';
  const all = S.clients(true).filter(c => showArch || !c.archived);
  const ts = S.tasks();
  return `<div class="toolbar"><span class="muted">${S.clients().length} clientes activos</span><span class="sp"></span>
    <a class="btn text sm" href="#/clients${showArch ? '' : '?arch=1'}">${showArch ? 'Ocultar archivados' : 'Ver archivados'}</a>
    <button class="btn filled" data-act="client-new">${icon('plus', 'sm')}Nuevo cliente</button></div>
  <div class="cgrid">${all.map(c => {
    const mine = ts.filter(t => t.clientId === c.id);
    const open = mine.filter(S.isOpen).length, over = mine.filter(t => S.isOverdue(t)).length;
    const doneM = mine.filter(t => t.status === 'done' && t.completedAt && ym(new Date(t.completedAt)) === ym(new Date())).length;
    return `<div class="ccard ${c.archived ? 'archived' : ''}" style="--c:${esc(c.color)}">
      <h4>${esc(c.name)}${c.archived ? '<span class="tag">Archivado</span>' : ''}<span style="flex:1"></span><button class="icon-btn sm" data-act="client-edit" data-id="${c.id}" title="Editar">${icon('edit', 'sm')}</button></h4>
      <div class="stats"><div><b>${open}</b>abiertas</div><div class="${over ? 'o' : ''}"><b>${over}</b>atrasadas</div><div><b>${doneM}</b>terminadas (mes)</div></div>
      ${c.notes ? `<div class="small muted">${esc(c.notes)}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <a class="btn tonal sm" href="#/tasks?f=active&client=${c.id}">${icon('tasks', 'sm')}Tareas</a>
        ${c.folderUrl ? `<a class="btn outlined sm" href="${esc(c.folderUrl)}" target="_blank" rel="noopener">${icon('folder', 'sm')}Drive</a>` : ''}
        <button class="btn outlined sm" data-act="task-for-client" data-id="${c.id}">${icon('plus', 'sm')}Tarea</button>
      </div></div>`;
  }).join('') || emptyBox('Sin clientes', 'clients', true)}</div>`;
}

// ---------------------------------------------------------------- AGENDA
function viewAgenda() {
  if (auth.valid && Date.now() - ui.eventsAt > 5 * 60e3) loadEvents();
  return `<div class="toolbar"><span class="muted">Próximos 14 días en tu Google Calendar</span><span class="sp"></span>
    ${auth.valid ? `<button class="btn outlined sm" data-act="events-refresh">${icon('sync', 'sm')}Actualizar</button>` : ''}
    <button class="btn filled" data-act="meet-new">${icon('video', 'sm')}Nueva reunión</button></div>
    <div class="card">${eventsBlock(14, 50)}</div>`;
}

// ---------------------------------------------------------------- AJUSTES
function viewSettings() {
  const st = store.state.settings;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const theme = localStorage.getItem('vkcrm.theme') || 'auto';
  const a = auth.data;
  return `<div class="grid dash">
  <section class="card span-6">
    <div class="card-h"><h3>${icon('user', 'sm')}Cuenta de Google</h3></div>
    ${!auth.configured ? `<div class="banner warn">${icon('alert')}<div class="t"><b>Falta configurar el ID de cliente OAuth</b><span>Edita <b>js/config.js</b> y pega tu GOOGLE_CLIENT_ID. Mientras tanto, la app funciona en modo local en este dispositivo.</span></div></div>` : ''}
    <div class="set-row"><div class="t"><b>${a?.email ? esc(a.name || a.email) : 'Sin conectar'}</b><span>${a?.email ? esc(a.email) + (auth.valid ? ' · sesión activa' : ' · sesión expirada') : 'Conecta para sincronizar con Drive, Tasks y Calendar'}</span></div>
      ${a?.email ? `${auth.valid ? '' : `<button class="btn tonal sm" data-act="reconnect">Reconectar</button>`}<button class="btn outlined sm" data-act="disconnect">Desconectar</button>` : `<button class="btn filled sm" data-act="connect" ${auth.configured ? '' : 'disabled'}>Conectar Google</button>`}</div>
    <div class="set-row"><div class="t"><b>Sincronización</b><span>${syncText()}</span></div><button class="btn outlined sm" data-act="sync-now" ${auth.valid ? '' : 'disabled'}>${icon('sync', 'sm')}Sincronizar</button></div>
    <div class="set-row"><div class="t"><b>Lista en Google Tasks</b><span>“${esc(CFG.GTASKS_LIST_NAME || 'Vertikal CRM')}”. Agrégala a tu widget de Android.</span></div></div>
    <div class="set-row"><div class="t"><b>Tareas que van al widget</b><span>Pendientes y atrasadas hasta esta fecha, más las terminadas hoy.</span></div>
      <select class="select mini" style="width:auto" data-ch="setting" data-k="syncAheadDays">${[[0, 'Solo hoy'], [1, 'Hoy y mañana'], [2, 'Próximos 2 días'], [7, 'Próximos 7 días']].map(([v, l]) => opt(v, l, st.syncAheadDays)).join('')}</select></div>
  </section>
  <section class="card span-6">
    <div class="card-h"><h3>${icon('bell', 'sm')}Notificaciones</h3></div>
    <div class="set-row"><div class="t"><b>Avisos de tareas atrasadas</b><span>${perm === 'granted' ? 'Permiso concedido' : perm === 'denied' ? 'Bloqueadas en el navegador. Actívalas desde la configuración del sitio.' : perm === 'unsupported' ? 'Este navegador no soporta notificaciones' : 'Necesitas dar permiso'}</span></div>
      ${perm === 'default' ? `<button class="btn filled sm" data-act="notif">Activar</button>` : `<button class="switch ${st.notify ? 'on' : ''}" data-act="notify-toggle" aria-label="Notificaciones"></button>`}</div>
    <div class="set-row"><div class="t"><b>Probar notificación</b><span>Instala la app (Agregar a pantalla de inicio) para recibir avisos en segundo plano en Android.</span></div><button class="btn outlined sm" data-act="notif-test" ${perm === 'granted' ? '' : 'disabled'}>Probar</button></div>
    <div class="set-row"><div class="t"><b>Correo nuevo → tarea “Revisar correo”</b><span>Lo hace el Apps Script incluido (apps-script/Code.gs) cada 5 minutos, aunque la app esté cerrada. Instrucciones en README.md.</span></div></div>
  </section>
  <section class="card span-6">
    <div class="card-h"><h3>${icon('tasks', 'sm')}Categorías</h3></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${S.categories().map(c => `<span class="tag" style="height:26px;gap:4px;padding-right:2px">${esc(c.name)}<button class="icon-btn sm" style="width:20px;height:20px" data-act="cat-del" data-id="${c.id}" title="Eliminar">${icon('close', 'xs')}</button></span>`).join('')}</div>
    <form class="add-row" data-form="cat"><input class="input mini" name="name" placeholder="Nueva categoría"><button class="btn tonal sm">Agregar</button></form>
  </section>
  <section class="card span-6">
    <div class="card-h"><h3>${icon('download', 'sm')}Datos</h3></div>
    <div class="set-row"><div class="t"><b>Importar mes de CM NOTES</b><span>En Sheets: Archivo › Descargar › CSV de la hoja del mes (ej. T - OCT).</span></div><button class="btn outlined sm" data-act="import-csv">Importar CSV</button></div>
    <div class="set-row"><div class="t"><b>Respaldo</b><span>Exporta o restaura todo en JSON.</span></div><button class="btn outlined sm" data-act="export">Exportar</button><button class="btn outlined sm" data-act="import-json">Restaurar</button></div>
    <div class="set-row"><div class="t"><b>Apariencia</b><span>Tema de este dispositivo</span></div><div class="seg">${[['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, l]) => `<button class="${theme === k ? 'on' : ''}" data-act="theme" data-v="${k}">${l}</button>`).join('')}</div></div>
    <div class="set-row"><div class="t"><b>Borrar datos locales</b><span>Solo en este dispositivo. Si estás conectado, se recuperan de Drive.</span></div><button class="btn danger sm" data-act="reset">Borrar</button></div>
  </section>
  </div>`;
}
const syncText = () => {
  const s = syncState;
  if (!auth.linked) return 'Modo local: los datos se guardan solo en este dispositivo';
  if (s.status === 'auth' || !auth.valid) return 'Sesión expirada. Reconecta para sincronizar.';
  if (s.status === 'error') return 'Error: ' + s.error;
  if (s.status === 'syncing') return 'Sincronizando…';
  return s.lastSync ? 'Última sincronización ' + relTime(s.lastSync) : 'Pendiente';
};

const VIEWS = { dashboard: viewDashboard, week: viewWeek, tasks: viewTasks, inbox: viewInbox, recurring: viewRecurring, clients: viewClients, agenda: viewAgenda, stats: viewStats, archive: viewArchive, settings: viewSettings };

// ---------------------------------------------------------------- HOJA DE DETALLE
function openTask(id) { ui.openId = id; renderSheet(); }
function closeSheet(update = true) {
  ui.openId = null; ui.archTask = null;
  $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); $('#sheet').setAttribute('aria-hidden', 'true');
}
function renderSheet() {
  const t = S.getTask(ui.openId);
  if (!t) { closeSheet(); return; }
  const sh = $('#sheet');
  const doneSub = t.subtasks.filter(s => s.done).length;
  const ups = ui.uploads[t.id] || [];
  sh.innerHTML = `
  <div class="sheet-h">
    <span class="code">${esc(t.code)}</span>${statusBtn(t)}${S.isOverdue(t) ? `<span class="over-pill">${icon('alert', 'xs')}Atrasada</span>` : ''}
    <span style="flex:1"></span>
    <button class="icon-btn" data-act="row-menu" data-id="${t.id}" title="Más">${icon('more')}</button>
    <button class="icon-btn" data-act="close-sheet" title="Cerrar (Esc)">${icon('close')}</button>
  </div>
  <div class="sheet-b">
    <input class="input ghost sheet-title" data-ch="tf" data-id="${t.id}" data-k="title" value="${esc(t.title)}" aria-label="Título">
    <div class="props">
      <label class="field"><span>Cliente</span><select class="select mini" data-ch="tf" data-id="${t.id}" data-k="clientId">${clientOptions(t.clientId)}</select></label>
      <label class="field"><span>Categoría</span><select class="select mini" data-ch="tf" data-id="${t.id}" data-k="categoryId">${catOptions(t.categoryId)}</select></label>
      <label class="field"><span>Estado</span><select class="select mini" data-ch="tf" data-id="${t.id}" data-k="status">${statusOptions(t.status, true)}</select></label>
      <label class="field"><span>Prioridad</span><select class="select mini" data-ch="tf" data-id="${t.id}" data-k="priority">${prioOptions(t.priority)}</select></label>
      <label class="field"><span>Fecha límite</span><input class="input mini" type="date" data-ch="tf" data-id="${t.id}" data-k="dueDate" value="${esc(t.dueDate)}"></label>
      <label class="field"><span>Hora</span><input class="input mini" type="time" data-ch="tf" data-id="${t.id}" data-k="dueTime" value="${esc(t.dueTime)}"></label>
    </div>
    <div class="stamps">
      <div class="stamp"><b>Ingresada</b><span>${fmtDateTime(t.createdAt)}</span></div>
      <div class="stamp"><b>Iniciada</b><span>${t.startedAt ? fmtDateTime(t.startedAt) : '—'}</span></div>
      <div class="stamp ${t.completedAt ? 'done-st' : ''}"><b>Finalizada</b><span>${t.completedAt ? fmtDateTime(t.completedAt) : '—'}</span></div>
    </div>

    <div class="section-title">Notas<span class="sp"></span></div>
    <textarea class="textarea" data-in="notes" data-id="${t.id}" placeholder="Agrega detalles, contexto, acuerdos…">${esc(t.notes)}</textarea>

    <div class="section-title">Subtareas ${t.subtasks.length ? `· ${doneSub}/${t.subtasks.length}` : ''}<span class="sp"></span></div>
    ${t.subtasks.length ? `<div class="progress-bar" style="margin-bottom:6px"><div style="width:${doneSub / t.subtasks.length * 100}%"></div></div>` : ''}
    ${t.subtasks.map(s => `<div class="sub-row ${s.done ? 'done' : ''}">
      <button class="check ${s.done ? 'on' : ''}" data-act="sub-toggle" data-id="${t.id}" data-sid="${s.id}">${icon('check')}</button>
      <input class="input ghost mini" data-ch="sub" data-id="${t.id}" data-sid="${s.id}" value="${esc(s.title)}">
      ${s.doneAt ? `<span class="small muted" style="white-space:nowrap">${fmtDate(ymd(new Date(s.doneAt)), false)}</span>` : ''}
      <button class="icon-btn sm danger" data-act="sub-del" data-id="${t.id}" data-sid="${s.id}" title="Eliminar">${icon('trash', 'sm')}</button></div>`).join('')}
    <form class="add-row" data-form="sub" data-id="${t.id}"><input class="input mini" name="title" placeholder="Agregar subtarea y presionar Enter"><button class="btn tonal sm">${icon('plus', 'sm')}</button></form>

    <div class="section-title">Enlaces · Docs, Sheets, Slides, PDF, carpetas<span class="sp"></span></div>
    ${t.links.map(l => `<div class="link-row"><span class="ficon f-${l.type}">${icon(typeIcon(l.type))}</span>
      <div class="lt"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a><small>${esc(linkInfo(l.url).label)}${l.addedAt ? ' · ' + fmtDate(ymd(new Date(l.addedAt)), false) : ''}</small></div>
      <button class="icon-btn sm" data-act="link-edit" data-id="${t.id}" data-lid="${l.id}" title="Renombrar">${icon('edit', 'sm')}</button>
      <button class="icon-btn sm danger" data-act="link-del" data-id="${t.id}" data-lid="${l.id}" title="Quitar">${icon('trash', 'sm')}</button></div>`).join('')}
    <form class="add-row" data-form="link" data-id="${t.id}"><input class="input mini" name="url" type="url" placeholder="Pega un enlace de Google Drive, Docs, Sheets, Slides o PDF"><button class="btn tonal sm">${icon('link', 'sm')}Enlazar</button></form>

    <div class="section-title">Archivos<span class="sp"></span></div>
    ${t.files.map(f => `<div class="link-row"><span class="ficon f-${f.type}">${icon(typeIcon(f.type))}</span>
      <div class="lt"><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a><small>${f.size ? fmtSize(f.size) + ' · ' : ''}Subido ${fmtDate(ymd(new Date(f.addedAt)), false)} a Drive</small></div>
      <button class="icon-btn sm danger" data-act="file-del" data-id="${t.id}" data-fid="${f.id}" title="Quitar de la tarea">${icon('trash', 'sm')}</button></div>`).join('')}
    ${ups.map(u => `<div class="link-row"><span class="ficon f-file">${icon('upload')}</span><div class="lt"><span>${esc(u.name)}</span><div class="progress-bar"><div style="width:${Math.round(u.pct * 100)}%"></div></div></div></div>`).join('')}
    <div class="dropzone" data-act="file-pick" data-id="${t.id}" data-drop-file="${t.id}">${icon('upload', 'sm')} Arrastra archivos o haz clic para subirlos a Drive</div>
    <input type="file" id="filePick" multiple hidden>

    <div class="section-title">Actividad<span class="sp"></span></div>
    ${t.log.slice(0, 12).map(l => `<div class="logline"><time>${fmtDateTime(l.at)}</time><span>${esc(l.text)}</span></div>`).join('')}

    <div class="sheet-actions">
      ${t.status === 'done' ? `<button class="btn outlined sm" data-act="toggle" data-id="${t.id}">Reabrir</button>` : `<button class="btn filled sm" data-act="toggle" data-id="${t.id}">${icon('check', 'sm')}Marcar terminada</button>`}
      ${t.status !== 'progress' && t.status !== 'done' ? `<button class="btn tonal sm" data-act="set-status" data-v="progress" data-id="${t.id}">${icon('play', 'sm')}Iniciar</button>` : ''}
      <button class="btn outlined sm" data-act="meet-new" data-id="${t.id}">${icon('video', 'sm')}Agendar reunión</button>
      <button class="btn outlined sm" data-act="dup" data-id="${t.id}">${icon('copy', 'sm')}Duplicar</button>
      <button class="btn danger sm" data-act="del" data-id="${t.id}">${icon('trash', 'sm')}Eliminar</button>
    </div>
  </div>`;
  sh.classList.add('on'); sh.setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('on');
}

// ---------------------------------------------------------------- DIÁLOGOS
function dialog(html, onSubmit, opts = {}) {
  const d = $('#dialog');
  d.innerHTML = `<form method="dialog" data-dlg>${html}</form>`;
  d.style.width = opts.width || '';
  const form = d.querySelector('form');
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('[type=submit]'); if (btn) btn.disabled = true;
    try { const r = await onSubmit(fd, form); if (r !== false) d.close(); }
    catch (err) { snack(err.message); console.error(err); }
    if (btn) btn.disabled = false;
  };
  form.querySelectorAll('[data-close]').forEach(b => b.onclick = () => d.close());
  d.showModal();
  setTimeout(() => form.querySelector('[autofocus]')?.focus(), 30);
  opts.after?.(form);
  return form;
}
const dlgHead = (title, ic) => `<div class="dlg-h">${ic ? icon(ic, 'lg') : ''}<h2>${title}</h2></div>`;
const dlgFoot = (ok = 'Guardar', extra = '') => `<div class="dlg-f">${extra}<span style="flex:1"></span><button type="button" class="btn text" data-close>Cancelar</button><button type="submit" class="btn filled">${ok}</button></div>`;

function taskDialog(preset = {}) {
  dialog(`${dlgHead(preset.status === 'inbox' ? 'Capturar en Inbox' : 'Nueva tarea', 'plus')}
  <div class="dlg-b">
    <label class="field"><span>Tarea</span><input class="input" name="title" required autofocus placeholder="¿Qué hay que hacer?"></label>
    <div class="row2">
      <label class="field"><span>Cliente</span><select class="select" name="clientId">${clientOptions(preset.clientId || '')}</select></label>
      <label class="field"><span>Categoría</span><select class="select" name="categoryId">${catOptions('')}</select></label>
    </div>
    <div class="row3">
      <label class="field"><span>Fecha límite</span><input class="input" type="date" name="dueDate" value="${preset.dueDate || (preset.status === 'inbox' ? '' : todayStr())}"></label>
      <label class="field"><span>Hora</span><input class="input" type="time" name="dueTime"></label>
      <label class="field"><span>Prioridad</span><select class="select" name="priority">${prioOptions('normal')}</select></label>
    </div>
    <label class="field"><span>Estado</span><select class="select" name="status">${statusOptions(preset.status || 'pending', true)}</select></label>
    <label class="field"><span>Notas</span><textarea class="textarea" name="notes" style="min-height:64px" placeholder="Opcional"></textarea></label>
  </div>${dlgFoot('Crear tarea', `<label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="openAfter"> Abrir al crear</label>`)}`, fd => {
    const t = S.addTask({ title: fd.title.trim(), clientId: fd.clientId || null, categoryId: fd.categoryId || null, priority: fd.priority, status: fd.status, dueDate: fd.dueDate, dueTime: fd.dueTime, notes: fd.notes });
    commit();
    snack(`Tarea ${t.code} creada`, 'Abrir', () => openTask(t.id));
    if (fd.openAfter) openTask(t.id);
  });
}

function clientDialog(c) {
  const isNew = !c; c = c || { id: uid(), name: '', color: CLIENT_COLORS[S.clients(true).length % CLIENT_COLORS.length], notes: '', folderUrl: '', archived: false };
  dialog(`${dlgHead(isNew ? 'Nuevo cliente' : 'Editar cliente', 'clients')}
  <div class="dlg-b">
    <label class="field"><span>Nombre</span><input class="input" name="name" required autofocus value="${esc(c.name)}"></label>
    <div class="field"><span>Color</span><div class="swatches">${CLIENT_COLORS.map(col => `<button type="button" class="swatch ${col === c.color ? 'on' : ''}" style="background:${col}" data-color="${col}" aria-label="${col}"></button>`).join('')}</div><input type="hidden" name="color" value="${esc(c.color)}"></div>
    <label class="field"><span>Carpeta de Drive del cliente (opcional)</span><input class="input" name="folderUrl" type="url" value="${esc(c.folderUrl || '')}" placeholder="https://drive.google.com/drive/folders/…"></label>
    <label class="field"><span>Notas</span><textarea class="textarea" name="notes" style="min-height:56px">${esc(c.notes || '')}</textarea></label>
  </div>${dlgFoot(isNew ? 'Crear cliente' : 'Guardar', isNew ? '' : `<button type="button" class="btn outlined sm" data-x="archive">${c.archived ? 'Restaurar' : 'Archivar'}</button><button type="button" class="btn danger sm" data-x="delete">Eliminar</button>`)}`, fd => {
    S.upsert('clients', { ...c, name: fd.name.trim(), color: fd.color, folderUrl: fd.folderUrl, notes: fd.notes });
    commit(); snack(isNew ? 'Cliente creado' : 'Cliente actualizado');
  }, {
    after: form => {
      form.querySelectorAll('.swatch').forEach(s => s.onclick = () => { form.querySelectorAll('.swatch').forEach(x => x.classList.remove('on')); s.classList.add('on'); form.color.value = s.dataset.color; });
      form.querySelector('[data-x=archive]')?.addEventListener('click', () => { S.upsert('clients', { ...c, archived: !c.archived }); commit(); $('#dialog').close(); snack(c.archived ? 'Cliente restaurado' : 'Cliente archivado'); });
      form.querySelector('[data-x=delete]')?.addEventListener('click', () => {
        const n = S.tasks().filter(t => t.clientId === c.id).length;
        if (n && !confirm(`${c.name} tiene ${n} tareas. Se quedarán como "Sin cliente". ¿Eliminar de todas formas?`)) return;
        if (n) S.tasks().filter(t => t.clientId === c.id).forEach(t => S.updateTask(t.id, { clientId: null }, true));
        S.remove('clients', c.id); commit(); $('#dialog').close(); snack('Cliente eliminado');
      });
    }
  });
}

function recurringDialog(r) {
  const isNew = !r; r = r || { id: uid(), title: '', clientId: '', categoryId: '', priority: 'normal', days: [], time: '', notes: '', active: true };
  let days = [...r.days];
  dialog(`${dlgHead(isNew ? 'Nueva tarea recurrente' : 'Editar recurrente', 'repeat')}
  <div class="dlg-b">
    <label class="field"><span>Tarea</span><input class="input" name="title" required autofocus value="${esc(r.title)}"></label>
    <div class="row2">
      <label class="field"><span>Cliente</span><select class="select" name="clientId">${clientOptions(r.clientId)}</select></label>
      <label class="field"><span>Categoría</span><select class="select" name="categoryId">${catOptions(r.categoryId)}</select></label>
    </div>
    <div class="row2">
      <label class="field"><span>Prioridad</span><select class="select" name="priority">${prioOptions(r.priority)}</select></label>
      <label class="field"><span>Hora límite (opcional)</span><input class="input" type="time" name="time" value="${esc(r.time)}"></label>
    </div>
    <div class="field"><span>Días del mes en que vence (una tarea por día marcado)</span>
      <div class="daypick">${[...Array(31)].map((_, i) => `<button type="button" data-day="${i + 1}" class="${days.includes(i + 1) ? 'on' : ''}">${i + 1}</button>`).join('')}<button type="button" data-day="L" class="${days.includes('L') ? 'on' : ''}" title="Último día del mes">Últ.</button></div>
      <span class="small muted" id="dayCount"></span></div>
    <label class="field"><span>Notas</span><textarea class="textarea" name="notes" style="min-height:56px">${esc(r.notes)}</textarea></label>
  </div>${dlgFoot(isNew ? 'Crear' : 'Guardar')}`, fd => {
    if (!days.length) { snack('Selecciona al menos un día del mes'); return false; }
    S.upsert('recurring', { ...r, title: fd.title.trim(), clientId: fd.clientId || null, categoryId: fd.categoryId || null, priority: fd.priority, time: fd.time, notes: fd.notes, days: days.sort((a, b) => (a === 'L' ? 99 : a) - (b === 'L' ? 99 : b)) });
    commit(); snack(isNew ? 'Recurrente creada' : 'Recurrente actualizada');
  }, {
    width: 'min(600px, calc(100vw - 24px))',
    after: form => {
      const upd = () => form.querySelector('#dayCount').textContent = days.length ? `${days.length} tarea${days.length > 1 ? 's' : ''} por mes` : 'Ningún día seleccionado';
      upd();
      form.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
        const v = b.dataset.day === 'L' ? 'L' : Number(b.dataset.day);
        days = days.includes(v) ? days.filter(x => x !== v) : [...days, v];
        b.classList.toggle('on'); upd();
      });
    }
  });
}

function quickDialog(q) {
  const isNew = !q; q = q || { id: uid(), title: '', url: '', type: 'link' };
  dialog(`${dlgHead(isNew ? 'Nuevo acceso rápido' : 'Editar acceso rápido', 'link')}
  <div class="dlg-b">
    <label class="field"><span>Nombre</span><input class="input" name="title" required value="${esc(q.title)}"></label>
    <label class="field"><span>Enlace</span><input class="input" name="url" type="url" autofocus value="${esc(q.url)}" placeholder="${esc(q.hint || 'https://docs.google.com/…')}"></label>
  </div>${dlgFoot('Guardar', isNew ? '' : `<button type="button" class="btn danger sm" data-x="del">Eliminar</button>`)}`, fd => {
    S.upsert('quick', { ...q, title: fd.title.trim(), url: fd.url.trim(), type: fd.url ? linkInfo(fd.url).type : q.type });
    commit();
  }, { after: form => form.querySelector('[data-x=del]')?.addEventListener('click', () => { S.remove('quick', q.id); commit(); $('#dialog').close(); }) });
}

function meetDialog(taskId) {
  const t = taskId ? S.getTask(taskId) : null;
  if (!auth.linked) { snack('Conecta tu cuenta de Google para agendar reuniones', 'Conectar', connect); return; }
  const start = new Date(); start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  dialog(`${dlgHead('Agendar reunión', 'video')}
  <div class="dlg-b">
    <label class="field"><span>Título</span><input class="input" name="title" required autofocus value="${esc(t ? `${t.title} · ${S.clientName(t.clientId)}` : '')}" placeholder="Reunión con…"></label>
    <div class="row3">
      <label class="field"><span>Fecha</span><input class="input" type="date" name="date" required value="${ymd(start)}"></label>
      <label class="field"><span>Hora</span><input class="input" type="time" name="time" required value="${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}"></label>
      <label class="field"><span>Duración</span><select class="select" name="dur">${[15, 30, 45, 60, 90, 120].map(m => opt(m, m < 60 ? m + ' min' : (m / 60) + ' h', 30)).join('')}</select></label>
    </div>
    <label class="field"><span>Invitados (correos separados por coma)</span><input class="input" name="guests" placeholder="cliente@empresa.com, equipo@vertikalcompany.com"></label>
    <label class="field"><span>Descripción</span><textarea class="textarea" name="desc" style="min-height:56px">${esc(t ? t.notes : '')}</textarea></label>
    <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="meet" checked> Agregar videollamada de Google Meet</label>
    ${!t ? `<label class="field"><span>Vincular a tarea (opcional)</span><select class="select" name="taskId">${opt('', 'Ninguna', '')}${S.tasks().filter(S.isOpen).sort(byDue).map(x => opt(x.id, `${x.code} · ${x.title} · ${S.clientName(x.clientId)}`, '')).join('')}</select></label>` : ''}
  </div>${dlgFoot('Crear en Calendar')}`, async fd => {
    if (!auth.valid) { await signIn(true); }
    const [y, m, d] = fd.date.split('-').map(Number); const [hh, mm] = fd.time.split(':').map(Number);
    const s = new Date(y, m - 1, d, hh, mm); const e = new Date(s.getTime() + Number(fd.dur) * 60e3);
    const iso = x => `${ymd(x)}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}:00`;
    const guests = (fd.guests || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /@/.test(x));
    if (guests.length && !confirm(`Google enviará la invitación a: ${guests.join(', ')}. ¿Continuar?`)) return false;
    const ev = await createEvent({ title: fd.title, description: fd.desc, start: iso(s), end: iso(e), attendees: guests, meet: !!fd.meet, tz: TZ });
    const linkTo = t ? t.id : fd.taskId;
    if (linkTo) {
      const task = S.getTask(linkTo);
      task.links.push({ id: uid(), url: ev.htmlLink, title: `Reunión: ${fd.title} (${fmtDate(fd.date)} ${fmtHM(fd.time)})`, type: 'calendar', addedAt: new Date().toISOString() });
      if (ev.hangoutLink) task.links.push({ id: uid(), url: ev.hangoutLink, title: 'Google Meet', type: 'link', addedAt: new Date().toISOString() });
      S.updateTask(linkTo, {}, true); S.addLog(linkTo, `Reunión agendada para ${fmtDate(fd.date)} ${fmtHM(fd.time)}`);
      commit();
    }
    ui.eventsAt = 0; loadEvents(true);
    snack('Reunión creada en Google Calendar', 'Abrir', () => window.open(ev.htmlLink, '_blank'));
  });
}

function csvDialog() {
  dialog(`${dlgHead('Importar mes desde CM NOTES', 'sheet')}
  <div class="dlg-b">
    <p class="muted" style="margin:0">En Google Sheets abre la hoja del mes (ej. “T - OCT”) y ve a Archivo › Descargar › Valores separados por comas (.csv). Las columnas TASK, CLIENT, CATEGORY, PRIORITY, STATUS, DUE DATE, DELIVERY, NOTES y ASSIGNED se convierten automáticamente; los clientes y categorías nuevos se crean solos.</p>
    <label class="field"><span>Mes de la hoja</span><input class="input" type="month" name="month" required value="${ym(new Date())}"></label>
    <label class="field"><span>Archivo CSV</span><input class="input" type="file" name="file" accept=".csv,text/csv" required style="padding-top:5px"></label>
  </div>${dlgFoot('Importar')}`, async (fd, form) => {
    const file = form.file.files[0]; const text = await file.text();
    const n = S.importSheetCSV(text, fd.month);
    commit(); snack(`${n} tareas importadas de ${monthName(fd.month)}`);
  });
}

// ---------------------------------------------------------------- MENÚS
function menu(anchor, items) {
  $$('.menu').forEach(m => m.remove());
  const m = document.createElement('div'); m.className = 'menu';
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}">${it.icon ? icon(it.icon, 'sm') : ''}${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
  m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  m.onclick = e => { const b = e.target.closest('button[data-i]'); if (!b) return; m.remove(); items[b.dataset.i].run(); };
  setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off, true); } }, true), 0);
}
const statusMenu = (el, id) => menu(el, Object.entries(STATUS).map(([k, v]) => ({ label: v.label, icon: v.icon, run: () => { S.updateTask(id, { status: k }); commit(); } })));
const rowMenu = (el, id) => {
  const t = S.getTask(id);
  menu(el, [
    { label: 'Abrir', icon: 'open', run: () => openTask(id) },
    { label: 'Iniciar (En desarrollo)', icon: 'play', run: () => { S.updateTask(id, { status: 'progress' }); commit(); } },
    { label: 'Mover a mañana', icon: 'calendar', run: () => { S.updateTask(id, { dueDate: ymd(addDays(new Date(), 1)) }); commit(); snack('Movida a mañana'); } },
    { label: 'Agendar reunión', icon: 'video', run: () => meetDialog(id) },
    { label: 'Duplicar', icon: 'copy', run: () => { const n = S.duplicateTask(id); commit(); snack(`Duplicada como ${n.code}`); } },
    { label: 'Enviar al Inbox', icon: 'inbox', run: () => { S.updateTask(id, { status: 'inbox' }); commit(); } },
    '-',
    { label: 'Eliminar', icon: 'trash', run: () => delTask(id) }
  ].filter(x => x === '-' || !(x.label.startsWith('Iniciar') && t.status === 'progress')));
};
function delTask(id) {
  const t = S.getTask(id); if (!t) return;
  S.deleteTask(id); if (ui.openId === id) closeSheet(); commit();
  snack(`“${t.title}” eliminada`, 'Deshacer', () => { t.deleted = false; t.updatedAt = Date.now(); commit(); });
}

// ---------------------------------------------------------------- ACCIONES
async function connect() {
  try { await signIn(); snack('Cuenta conectada. Sincronizando…'); await syncAll({ reason: 'connect' }); loadEvents(true); render(); }
  catch (e) { snack('No se pudo conectar: ' + e.message); }
}
async function reconnect() {
  try { await signIn(true); await syncAll({ reason: 'reconnect' }); loadEvents(true); render(); }
  catch (e) { snack('No se pudo reconectar: ' + e.message); }
}

const ACTIONS = {
  open: el => openTask(el.dataset.id),
  toggle: el => { const t = S.toggleDone(el.dataset.id); commit(); if (t.status === 'done') snack(`Terminada ${fmtDateTime(t.completedAt)}`, 'Deshacer', () => { S.toggleDone(t.id); commit(); }); },
  'status-menu': el => statusMenu(el, el.dataset.id),
  'row-menu': el => rowMenu(el, el.dataset.id),
  'set-status': el => { S.updateTask(el.dataset.id, { status: el.dataset.v }); commit(); },
  'close-sheet': () => closeSheet(),
  'filter-st': el => { ui.f.st = el.dataset.v; history.replaceState(null, '', '#/tasks'); render(); },
  'clear-filters': () => { ui.f.client = ''; ui.f.cat = ''; ui.f.period = 'all'; history.replaceState(null, '', '#/tasks'); render(); },
  'clear-q': () => { ui.f.q = ''; $('#globalSearch').value = ''; render(); },
  view: el => { ui.f.view = el.dataset.v; localStorage.setItem('vkcrm.view', ui.f.view); render(); },
  'new-task': () => taskDialog(),
  'inbox-capture': () => taskDialog({ status: 'inbox' }),
  'task-for-client': el => taskDialog({ clientId: el.dataset.id }),
  dup: el => { const n = S.duplicateTask(el.dataset.id); commit(); openTask(n.id); snack(`Duplicada como ${n.code}`); },
  del: el => delTask(el.dataset.id),
  'ibx-move': el => {
    const t = S.getTask(el.dataset.id);
    if (!t.clientId) { snack('Asigna un cliente antes de mover la tarea'); return; }
    S.updateTask(t.id, { status: 'pending', dueDate: t.dueDate || todayStr() }); commit(); snack('Tarea movida a Pendientes', 'Abrir', () => openTask(t.id));
  },
  'sub-toggle': el => { const t = S.getTask(el.dataset.id); const s = t.subtasks.find(x => x.id === el.dataset.sid); s.done = !s.done; s.doneAt = s.done ? new Date().toISOString() : null; S.updateTask(t.id, {}, true); commit(); },
  'sub-del': el => { const t = S.getTask(el.dataset.id); t.subtasks = t.subtasks.filter(x => x.id !== el.dataset.sid); S.updateTask(t.id, {}, true); commit(); },
  'link-del': el => { const t = S.getTask(el.dataset.id); t.links = t.links.filter(x => x.id !== el.dataset.lid); S.updateTask(t.id, {}, true); commit(); },
  'link-edit': el => { const t = S.getTask(el.dataset.id); const l = t.links.find(x => x.id === el.dataset.lid); const n = prompt('Nombre del enlace', l.title); if (n) { l.title = n.trim(); S.updateTask(t.id, {}, true); commit(); } },
  'file-del': el => { const t = S.getTask(el.dataset.id); t.files = t.files.filter(x => x.id !== el.dataset.fid); S.updateTask(t.id, {}, true); commit(); snack('Archivo quitado de la tarea (sigue en tu Drive)'); },
  'file-pick': el => { const inp = $('#filePick'); inp.onchange = () => { uploadFiles(el.dataset.id, [...inp.files]); inp.value = ''; }; inp.click(); },
  'meet-new': el => meetDialog(el.dataset.id),
  'events-refresh': () => loadEvents(true),
  'client-new': () => clientDialog(),
  'client-edit': el => clientDialog(S.getClient(el.dataset.id)),
  'rec-new': () => recurringDialog(),
  'rec-edit': el => recurringDialog(store.state.recurring.find(r => r.id === el.dataset.id)),
  'rec-toggle': el => { const r = store.state.recurring.find(r => r.id === el.dataset.id); S.upsert('recurring', { ...r, active: !r.active }); commit(); },
  'rec-more': el => {
    const r = store.state.recurring.find(r => r.id === el.dataset.id);
    const m = $('#genMonth')?.value || monthAdd(ym(new Date()), 1);
    menu(el, [
      { label: 'Editar', icon: 'edit', run: () => recurringDialog(r) },
      { label: `Generar en ${monthName(m)}`, icon: 'play', run: () => { const n = S.generateRecurring(m, { onlyTemplate: r.id }); commit(); snack(n ? `${n} tareas creadas en ${monthName(m)}` : 'Ya existían esas tareas'); } },
      { label: 'Duplicar', icon: 'copy', run: () => { S.upsert('recurring', { ...structuredClone(r), id: uid(), title: r.title + ' (copia)' }); commit(); } },
      '-',
      { label: 'Eliminar', icon: 'trash', run: () => { if (confirm(`¿Eliminar la recurrente “${r.title}”? Las tareas ya generadas se conservan.`)) { S.remove('recurring', r.id); commit(); } } }
    ]);
  },
  'rec-gen': () => {
    const m = $('#genMonth').value;
    if (store.state.settings.recurringGenerated?.[m] && !confirm(`${monthName(m)} ya fue generado. Solo se crearán las tareas que falten. ¿Continuar?`)) return;
    const n = S.generateRecurring(m); commit(); snack(`${n} tareas creadas para ${monthName(m)}`);
  },
  'quick-add': () => quickDialog(),
  'quick-edit': el => quickDialog(store.state.quick.find(q => q.id === el.dataset.id)),
  connect: () => connect(),
  reconnect: () => reconnect(),
  disconnect: () => { if (confirm('¿Desconectar tu cuenta de Google? Los datos quedan en este dispositivo y en tu Drive.')) { signOut(); ui.events = []; ui.eventsAt = 0; render(); } },
  'sync-now': () => syncAll({ reason: 'manual' }).then(() => snack(syncState.status === 'ok' ? 'Sincronizado' : syncText())),
  notif: async () => { const p = await Notification.requestPermission(); if (p === 'granted') { await registerPeriodic(); snack('Notificaciones activadas'); } render(); },
  'notify-toggle': () => { S.setSetting('notify', !store.state.settings.notify); commit(); },
  'notif-test': async () => { const reg = await navigator.serviceWorker?.ready; (reg ? reg.showNotification('Vertikal CRM', { body: 'Las notificaciones funcionan correctamente.', icon: 'icons/icon-192.png' }) : new Notification('Vertikal CRM', { body: 'Las notificaciones funcionan.' })); },
  theme: el => { localStorage.setItem('vkcrm.theme', el.dataset.v); applyTheme(); render(); },
  'cat-del': el => { const n = S.tasks().filter(t => t.categoryId === el.dataset.id).length; if (n && !confirm(`${n} tareas usan esta categoría. ¿Eliminarla?`)) return; S.remove('categories', el.dataset.id); commit(); },
  export: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' })); a.download = `vertikal-crm-${todayStr()}.json`; a.click(); },
  'import-json': () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'; inp.onchange = async () => { try { const data = JSON.parse(await inp.files[0].text()); store.state = S.mergeStates(store.state, data); commit(); snack('Respaldo restaurado (combinado con tus datos)'); } catch (e) { snack('Archivo no válido'); } }; inp.click(); },
  'import-csv': () => csvDialog(),
  reset: () => { if (confirm('¿Borrar los datos de este dispositivo?')) { localStorage.removeItem('vkcrm.data.v1'); location.reload(); } },
  'more-nav': el => menu(el, NAV.filter(n => !MOBILE_NAV.includes(n.id)).map(n => ({ label: n.label, icon: n.icon, run: () => location.hash = '#/' + n.id }))),
  account: el => {
    if (!auth.linked) return connect();
    menu(el, [
      { label: auth.data.email, icon: 'user', run: () => location.hash = '#/settings' },
      { label: 'Sincronizar ahora', icon: 'sync', run: () => auth.valid ? syncAll({ reason: 'manual' }) : reconnect() },
      { label: 'Ajustes', icon: 'settings', run: () => location.hash = '#/settings' }
    ]);
  }
};

async function uploadFiles(taskId, files) {
  if (!files.length) return;
  if (!auth.linked) { snack('Conecta tu cuenta de Google para subir archivos a Drive', 'Conectar', connect); return; }
  if (!auth.valid) { try { await signIn(true); } catch { snack('Reconecta tu cuenta para subir archivos'); return; } }
  const t = S.getTask(taskId);
  ui.uploads[taskId] = files.map(f => ({ name: f.name, pct: 0 }));
  renderSheetIfOpen(taskId);
  for (const [i, f] of files.entries()) {
    try {
      const r = await uploadFile(f, S.clientName(t.clientId), p => { ui.uploads[taskId][i].pct = p; renderSheetIfOpen(taskId); });
      t.files.push({ id: uid(), driveId: r.id, name: r.name, url: r.webViewLink, type: mimeToType(r.mimeType), size: Number(r.size || f.size), addedAt: new Date().toISOString() });
      S.updateTask(taskId, {}, true); S.addLog(taskId, `Archivo subido: ${r.name}`);
      ui.uploads[taskId][i].pct = 1;
    } catch (e) { snack(`No se pudo subir ${f.name}: ${e.message}`); }
  }
  delete ui.uploads[taskId];
  commit();
}
const renderSheetIfOpen = id => { if (ui.openId === id) renderSheet(); };

async function addLink(taskId, url) {
  url = url.trim(); if (!/^https?:\/\//.test(url)) { snack('Pega un enlace válido (https://…)'); return; }
  const info = linkInfo(url);
  const t = S.getTask(taskId);
  const link = { id: uid(), url, title: info.label, type: info.type, addedAt: new Date().toISOString() };
  t.links.push(link); S.updateTask(taskId, {}, true); S.addLog(taskId, `Enlace agregado: ${info.label}`); commit();
  if (info.driveId && auth.valid) {
    try { const m = await driveMeta(info.driveId); link.title = m.name; link.type = mimeToType(m.mimeType) === 'file' ? info.type : mimeToType(m.mimeType); S.updateTask(taskId, {}, true); commit(); }
    catch { /* sin permiso para leer el nombre: se queda el tipo */ }
  } else if (!info.driveId) {
    try { link.title = new URL(url).hostname.replace(/^www\./, '') + (url.match(/\/([^/?#]+\.pdf)/i) ? ' · ' + decodeURIComponent(url.match(/\/([^/?#]+\.pdf)/i)[1]) : ''); S.updateTask(taskId, {}, true); commit(); } catch {}
  }
}

// ---------------------------------------------------------------- EVENTOS GLOBALES
document.addEventListener('click', e => {
  if (Date.now() < (ui.suppressUntil || 0)) { e.preventDefault(); return; }
  const go = e.target.closest('[data-go]');
  if (go) { location.hash = go.dataset.go; return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'more-nav' || el.tagName === 'A' && act) e.preventDefault();
  if (act === 'open' && e.target.closest('button, a, select, input')) return;
  e.stopPropagation();
  ACTIONS[act]?.(el, e);
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-ch]'); if (!el) return;
  const k = el.dataset.k, v = el.value;
  switch (el.dataset.ch) {
    case 'tf': {
      if (k === 'title' && !v.trim()) { el.value = S.getTask(el.dataset.id).title; return; }
      S.updateTask(el.dataset.id, { [k]: k === 'clientId' || k === 'categoryId' ? (v || null) : v });
      commit(); break;
    }
    case 'sub': { const t = S.getTask(el.dataset.id); const s = t.subtasks.find(x => x.id === el.dataset.sid); if (v.trim()) { s.title = v.trim(); S.updateTask(t.id, {}, true); commit({ from: 'sheet' }); } break; }
    case 'filter': ui.f[k] = v; render(); break;
    case 'setting': S.setSetting(k, isNaN(Number(v)) ? v : Number(v)); commit(); break;
  }
});

const saveNotes = debounce((id, v) => { const t = S.getTask(id); if (t && t.notes !== v) { S.updateTask(id, { notes: v }, true); commit({ from: 'sheet' }); } }, 700);
document.addEventListener('input', e => {
  if (e.target.dataset?.in === 'notes') saveNotes(e.target.dataset.id, e.target.value);
});

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(f));
  switch (f.dataset.form) {
    case 'capture': {
      if (!fd.title.trim()) return;
      S.addTask({ title: fd.title.trim(), status: 'inbox', logText: 'Capturada en Inbox' }); commit();
      $('[data-form=capture] input')?.focus(); break;
    }
    case 'sub': {
      if (!fd.title.trim()) return;
      const t = S.getTask(f.dataset.id); t.subtasks.push({ id: uid(), title: fd.title.trim(), done: false, createdAt: new Date().toISOString(), doneAt: null });
      S.updateTask(t.id, {}, true); commit();
      $('#sheet [data-form=sub] input')?.focus(); break;
    }
    case 'link': if (fd.url) addLink(f.dataset.id, fd.url); break;
    case 'cat': if (fd.name.trim()) { S.ensureCategory(fd.name); commit(); } break;
  }
});

// Arrastrar y soltar (tablero y archivos)
document.addEventListener('dragstart', e => { const c = e.target.closest?.('[data-drag]'); if (c) { e.dataTransfer.setData('text/vk-task', c.dataset.drag); c.classList.add('dragging'); } });
document.addEventListener('dragend', e => { e.target.classList?.remove('dragging'); $$('.col.drop').forEach(c => c.classList.remove('drop')); });
document.addEventListener('dragover', e => {
  const col = e.target.closest?.('[data-drop]'); const dz = e.target.closest?.('[data-drop-file]');
  if (col && e.dataTransfer.types.includes('text/vk-task')) { e.preventDefault(); $$('.col.drop').forEach(c => c !== col && c.classList.remove('drop')); col.classList.add('drop'); }
  if (dz && e.dataTransfer.types.includes('Files')) { e.preventDefault(); dz.classList.add('over'); }
});
document.addEventListener('dragleave', e => { const dz = e.target.closest?.('[data-drop-file]'); if (dz) dz.classList.remove('over'); });
document.addEventListener('drop', e => {
  const col = e.target.closest?.('[data-drop]'); const dz = e.target.closest?.('[data-drop-file]');
  if (col) { e.preventDefault(); const id = e.dataTransfer.getData('text/vk-task'); if (id) { S.updateTask(id, { status: col.dataset.drop }); commit(); } }
  if (dz) { e.preventDefault(); dz.classList.remove('over'); uploadFiles(dz.dataset.dropFile, [...e.dataTransfer.files]); }
});

// Tooltips
document.addEventListener('mouseover', e => {
  const el = e.target.closest?.('[data-tip]'); const tip = $('#tooltip');
  if (!el) { tip.classList.remove('on'); return; }
  tip.textContent = el.dataset.tip; tip.classList.add('on');
  const r = el.getBoundingClientRect();
  tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
  tip.style.top = Math.max(8, r.top - tip.offsetHeight - 6) + 'px';
});

// Teclado
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === 'Escape' && ui.openId && !$('#dialog').open) { closeSheet(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $('#dialog').open) return;
  if (e.key === '/') { e.preventDefault(); $('#globalSearch').focus(); }
  else if (e.key === 'n') { e.preventDefault(); taskDialog(); }
  else if (e.key === 'i') { e.preventDefault(); taskDialog({ status: 'inbox' }); }
});

$('#scrim').addEventListener('click', () => closeSheet());
$('#fab').addEventListener('click', () => taskDialog());
$('#accountBtn').addEventListener('click', e => ACTIONS.account(e.currentTarget));
$('#syncChip').addEventListener('click', () => { if (!auth.linked) location.hash = '#/settings'; else if (!auth.valid) reconnect(); else syncAll({ reason: 'chip' }); });
$('#themeBtn').addEventListener('click', () => { const order = ['auto', 'light', 'dark']; const cur = localStorage.getItem('vkcrm.theme') || 'auto'; localStorage.setItem('vkcrm.theme', order[(order.indexOf(cur) + 1) % 3]); applyTheme(); snack('Tema: ' + { auto: 'automático', light: 'claro', dark: 'oscuro' }[localStorage.getItem('vkcrm.theme')]); });
$('#globalSearch').addEventListener('input', debounce(e => {
  ui.f.q = e.target.value;
  if (ui.route !== 'tasks' && ui.f.q) { ui.f.st = 'all'; location.hash = '#/tasks'; } else render();
  setTimeout(() => { const s = $('#globalSearch'); s.focus(); }, 0);
}, 200));
window.addEventListener('hashchange', () => { parseHash(); render(); $('#view').scrollTop = 0; window.scrollTo(0, 0); });

// ---------------------------------------------------------------- render auxiliar
function afterRender() {
  const cap = $('[data-form=capture] input'); if (cap && ui.params.focus) cap.focus();
}
function renderAccount() {
  const a = auth.data; const btn = $('#accountBtn');
  btn.innerHTML = a?.picture ? `<img src="${esc(a.picture)}" alt="" referrerpolicy="no-referrer">` : icon('user');
  btn.title = a?.email || 'Conectar cuenta de Google';
  const chip = $('#syncChip'); const s = syncState.status;
  const map = { local: ['', 'Local', 'cloud'], syncing: ['syncing', 'Sincronizando', 'sync'], ok: ['ok', 'Sincronizado', 'check'], error: ['err', 'Error', 'alert'], auth: ['warn', 'Reconectar', 'sync'] };
  const [cls, txt, ic] = auth.linked && !auth.valid && s !== 'syncing' ? map.auth : map[s] || map.local;
  chip.className = 'chip-btn ' + cls; chip.innerHTML = icon(ic) + `<span>${txt}</span>`; chip.title = syncText();
}

let snackTimer;
function snack(text, action, fn) {
  const s = $('#snackbar');
  s.innerHTML = `<span>${esc(text)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) s.querySelector('button').onclick = () => { s.classList.remove('on'); fn(); };
  s.classList.add('on'); clearTimeout(snackTimer); snackTimer = setTimeout(() => s.classList.remove('on'), action ? 6000 : 3200);
}

function applyTheme() {
  const t = localStorage.getItem('vkcrm.theme') || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name=theme-color]').forEach(m => { m.content = dark ? '#0E1024' : '#F7F8FC'; m.removeAttribute('media'); });
}

// ---------------------------------------------------------------- commit + render
function commit(meta = {}) { store.commit(meta); }
store.subscribe(meta => {
  renderNav();
  const sheetFocused = $('#sheet').contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  const viewFocused = $('#view').contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if (!viewFocused || meta.from === 'sheet') { $('#view').innerHTML = VIEWS[ui.route](); afterRender(); }
  if (ui.openId && meta.from !== 'sheet' && !(meta.remote && sheetFocused)) renderSheet();
  else if (ui.archTask && !ui.openId) renderArchSheet();
  if (!meta.remote) scheduleSync();
  if (meta.recurring?.n) snack(`${meta.recurring.n} tareas recurrentes generadas para ${meta.recurring.months.map(m => monthName(m)).join(' y ')}`);
  checkOverdue();
});
onSync(() => { renderAccount(); if (ui.route === 'settings') { $('#view').innerHTML = viewSettings(); } });
auth.onChange(() => renderAccount());

// ---------------------------------------------------------------- notificaciones de atrasadas
const NK = 'vkcrm.notified';
async function checkOverdue() {
  const over = S.tasks().filter(t => S.isOverdue(t));
  if ('setAppBadge' in navigator) (over.length ? navigator.setAppBadge(over.length) : navigator.clearAppBadge()).catch(() => {});
  try { const c = await caches.open('vkcrm-snapshot'); const prev = await c.match('./__snapshot.json').then(r => r?.json()).catch(() => null); await c.put('./__snapshot.json', new Response(JSON.stringify({ ...(prev || {}), tasks: S.overdueSnapshot() }), { headers: { 'content-type': 'application/json' } })); } catch {}
  if (!store.state.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  let seen; try { seen = new Set(JSON.parse(localStorage.getItem(NK) || '[]')); } catch { seen = new Set(); }
  const key = t => `${t.id}|${t.dueDate}|${t.dueTime}`;
  const fresh = over.filter(t => !seen.has(key(t)));
  if (!fresh.length) return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const show = (title, body, tag, url) => reg ? reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/favicon.png', data: { url } }) : new Notification(title, { body, tag });
  if (fresh.length > 3) show(`${fresh.length} tareas atrasadas`, fresh.slice(0, 4).map(t => '• ' + t.title).join('\n'), 'vk-overdue', './#/tasks?f=overdue');
  else fresh.forEach(t => show('Tarea atrasada', `${t.title} · ${S.clientName(t.clientId)}\nVencía ${fmtDate(t.dueDate)}${t.dueTime ? ' ' + fmtHM(t.dueTime) : ''}`, t.id, './#/task/' + t.id));
  fresh.forEach(t => seen.add(key(t)));
  localStorage.setItem(NK, JSON.stringify([...seen].slice(-400)));
}
async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state === 'granted') await reg.periodicSync.register('vk-overdue', { minInterval: 60 * 60 * 1000 });
  } catch {}
}

// ================================================================ v2: archivo, semana, estadísticas, exportaciones

// ---------------------------------------------------------------- utilidades de mes
const shortMonth = m => S.monthLabel(m).slice(0, 3);
const fmtDur = ms => {
  if (ms == null || isNaN(ms)) return '—';
  const h = ms / 3600e3;
  if (h < 1) return Math.max(1, Math.round(ms / 60e3)) + ' min';
  if (h < 24) return h.toFixed(1).replace('.0', '') + ' h';
  return (h / 24).toFixed(1).replace('.0', '') + ' días';
};
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const absDate = s => { if (!s) return ''; const d = parseYmd(s); return `${d.getDate()} ${shortMonth(ym(d))}`; };
const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

function monthData(m) {
  const a = S.getArchive(m);
  if (a) return { archived: true, archivedAt: a.archivedAt, done: a.tasks.map(t => ({ ...t, _refs: a })), pending: (a.pending || []).map(t => ({ ...t, _refs: a })) };
  if (S.isArchived(m)) return { archived: true, missing: true, done: [], pending: [] };
  const { done, pending } = S.archivePreview(m);
  return { archived: false, done, pending };
}

function summarize(done) {
  const byClient = new Map(), byCat = new Map();
  for (const t of done) {
    const c = S.refClientName(t), k = S.refCategoryName(t);
    if (!byClient.has(c)) byClient.set(c, { name: c, color: S.refClientColor(t), list: [] });
    byClient.get(c).list.push(t);
    if (!byCat.has(k)) byCat.set(k, { name: k, list: [] });
    byCat.get(k).list.push(t);
  }
  const rows = map => [...map.values()].map(r => ({
    ...r, n: r.list.length, late: r.list.filter(S.wasLate).length,
    avg: avg(r.list.map(S.deliveryMs).filter(x => x != null))
  })).sort((a, b) => b.n - a.n);
  return {
    n: done.length, late: done.filter(S.wasLate).length,
    avg: avg(done.map(S.deliveryMs).filter(x => x != null)),
    clients: rows(byClient), cats: rows(byCat)
  };
}

// ---------------------------------------------------------------- banner y diálogo de archivo
function archiveBanner() {
  const ms = S.archivableMonths(); if (!ms.length) return '';
  const m = ms[0]; const { done, pending } = S.archivePreview(m);
  return `<div class="banner arch">${icon('archive')}<div class="t"><b>Cierre de ${S.monthLabel(m)}</b><span>${done.length} tareas terminadas listas para archivar · ${pending.length} pendientes pasan a ${S.monthLabel(monthAdd(m, 1))}${ms.length > 1 ? ` · ${ms.length - 1} mes${ms.length > 2 ? 'es' : ''} más por archivar` : ''}</span></div>
    <button class="btn filled sm" data-act="archive-month" data-m="${m}">${icon('archive', 'sm')}Archivar mes</button></div>`;
}

function archiveDialog(m) {
  const { done, pending } = S.archivePreview(m);
  dialog(`${dlgHead('Archivar ' + S.monthLabel(m), 'archive')}
  <div class="dlg-b">
    <p style="margin:0">Se guardarán <b>${done.length} tareas terminadas</b> en ${S.monthLabel(m)} con toda su información: notas, subtareas, enlaces, archivos, fechas e historial. Quedarán en <b>Archivo</b> como solo lectura.</p>
    <p style="margin:0" class="muted">${pending.length ? `${pending.length} tareas sin terminar siguen activas y pasan a ${S.monthLabel(monthAdd(m, 1))} con la marca “De ${shortMonth(m)}”.` : 'No quedan tareas pendientes de este mes.'}</p>
    <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="pdf" checked> Abrir el reporte PDF del mes al terminar</label>
  </div>${dlgFoot('Archivar mes')}`, fd => {
    const win = fd.pdf ? window.open('', '_blank') : null;
    S.archiveMonth(m); commit();
    snack(`${S.monthLabel(m)} archivado`, 'Ver', () => { location.hash = '#/archive/' + m; });
    if (win) openReport(m, win);
  });
}

// ---------------------------------------------------------------- vista Archivo
function viewArchive() {
  if (ui.archOpen) return viewArchiveMonth(ui.archOpen);
  const cur = ym(new Date());
  const pending = S.archivableMonths();
  const months = S.archivedMonths();
  const live = S.isArchived(cur) ? null : summarize(S.archivePreview(cur).done);
  const card = (m, info, isLive) => `<div class="ccard amonth" style="--c:${isLive ? 'var(--brand-green)' : 'var(--navy)'}">
    <h4>${S.monthLabel(m)}${isLive ? '<span class="tag">En curso</span>' : `<span class="lock-chip">${icon('lock')}Archivado</span>`}</h4>
    <div class="stats"><div><b>${info.count}</b>terminadas</div><div><b>${info.pending ?? 0}</b>pasaron al siguiente</div><div><b>${S.monthCount(m)}</b>creadas</div></div>
    <div class="small muted">${isLive ? 'Se puede archivar desde el último día del mes' : 'Archivado el ' + fmtDateTime(info.archivedAt)}${!isLive && !S.getArchive(m) ? ' · se descarga al sincronizar con Google' : ''}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${isLive ? `<a class="btn tonal sm" href="#/tasks?f=done">${icon('tasks', 'sm')}Ver terminadas</a>` : `<a class="btn tonal sm" href="#/archive/${m}">${icon('eye', 'sm')}Ver tareas</a>`}
      <button class="btn outlined sm" data-act="report" data-m="${m}">${icon('pdf', 'sm')}PDF</button>
      <button class="btn outlined sm" data-act="sheet-export" data-m="${m}">${icon('sheet', 'sm')}Sheets</button>
    </div></div>`;
  return `${pending.map(m => { const p = S.archivePreview(m); return `<div class="banner arch">${icon('archive')}<div class="t"><b>${S.monthLabel(m)} está listo para archivar</b><span>${p.done.length} terminadas · ${p.pending.length} pasan a ${S.monthLabel(monthAdd(m, 1))}</span></div><button class="btn filled sm" data-act="archive-month" data-m="${m}">Archivar mes</button></div>`; }).join('')}
  <div class="toolbar"><span class="muted">Cada mes archivado guarda las tareas terminadas tal como estaban, en solo lectura.</span></div>
  <div class="cgrid">
    ${live ? card(cur, { count: live.n, pending: S.archivePreview(cur).pending.length }, true) : ''}
    ${months.map(m => card(m, store.state.settings.archives[m], false)).join('')}
  </div>
  ${!months.length ? `<div class="card" style="margin-top:12px">${emptyBox('Todavía no hay meses archivados. El último día de cada mes aparecerá la opción “Archivar mes”.', 'archive', true)}</div>` : ''}`;
}

function viewArchiveMonth(m) {
  const d = monthData(m);
  if (d.missing) {
    if (auth.valid && !ui.archLoading) {
      ui.archLoading = true;
      archiveLoad(m).then(r => { if (r) S.saveArchive({ ...r, uploaded: true }); }).catch(e => snack(e.message)).finally(() => { ui.archLoading = false; if (ui.route === 'archive') render(); });
    }
    return `<a class="btn text sm" href="#/archive">${icon('left', 'sm')}Archivo</a><div class="card">${emptyBox(auth.valid ? 'Descargando el archivo de ' + S.monthLabel(m) + '…' : 'Conecta tu cuenta de Google para ver este mes archivado.', 'archive', true)}</div>`;
  }
  const f = ui.archF, q = f.q.trim().toLowerCase();
  const sum = summarize(d.done);
  const clientsOpt = [...new Map(d.done.map(t => [t.clientId || '', S.refClientName(t)])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const catsOpt = [...new Map(d.done.map(t => [t.categoryId || '', S.refCategoryName(t)])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  let list = d.done.filter(t => (!f.client || (t.clientId || '') === f.client) && (!f.cat || (t.categoryId || '') === f.cat)
    && (!q || [t.title, t.code, t.notes, S.refClientName(t), S.refCategoryName(t), ...(t.subtasks || []).map(s => s.title)].join(' ').toLowerCase().includes(q)));
  list.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  let last = '', rows = '';
  for (const t of list) {
    const day = ymd(new Date(t.completedAt));
    if (day !== last) { rows += `<div class="section-title">${fmtLongDate(parseYmd(day))}<span class="sp"></span></div>`; last = day; }
    rows += `<div class="arow" data-act="arch-open" data-m="${m}" data-id="${t.id}">
      <span class="code">${esc(t.code)}</span><span class="t">${esc(t.title)}</span>
      <span class="cchip a-hide"><i class="cdot" style="background:${esc(S.refClientColor(t))}"></i><span class="n">${esc(S.refClientName(t))}</span></span>
      <span class="a-hide"><span class="tag">${esc(S.refCategoryName(t))}</span></span>
      <span class="small a-hide">${fmtTime(new Date(t.completedAt))}${t.dueDate ? ' · vencía ' + absDate(t.dueDate) : ''}</span>
      <span class="small ${S.wasLate(t) ? 'late' : 'ontime'}">${S.wasLate(t) ? 'Tarde' : 'A tiempo'}</span></div>`;
  }
  return `<div class="toolbar"><a class="btn text sm" href="#/archive">${icon('left', 'sm')}Archivo</a>
    <h2 style="margin:0;font-size:18px;text-transform:capitalize">${S.monthLabel(m)}</h2>
    ${d.archived ? `<span class="lock-chip">${icon('lock')}Archivado ${fmtDateTime(d.archivedAt)}</span>` : ''}
    <span class="sp"></span>
    <button class="btn outlined sm" data-act="report" data-m="${m}">${icon('pdf', 'sm')}Exportar PDF</button>
    <button class="btn outlined sm" data-act="sheet-export" data-m="${m}">${icon('sheet', 'sm')}Exportar a Sheets</button></div>
  <div class="stiles">
    <div class="stile"><div class="lbl">Terminadas</div><div class="val">${sum.n}</div><div class="sub">${sum.clients.length} clientes</div></div>
    <div class="stile"><div class="lbl">A tiempo</div><div class="val">${pct(sum.n - sum.late, sum.n)}%</div><div class="sub">${sum.late} tarde</div></div>
    <div class="stile"><div class="lbl">Entrega promedio</div><div class="val">${fmtDur(sum.avg)}</div><div class="sub">de ingreso a finalización</div></div>
    <div class="stile"><div class="lbl">Cliente principal</div><div class="val" style="font-size:16px;padding-top:6px">${esc(sum.clients[0]?.name || '—')}</div><div class="sub">${sum.clients[0] ? pl(sum.clients[0].n, 'tarea') : ''}</div></div>
    <div class="stile"><div class="lbl">Pasaron al siguiente mes</div><div class="val">${d.pending.length}</div><div class="sub">pendientes al cierre</div></div>
  </div>
  <div class="toolbar">
    <select class="select mini" style="width:auto" data-ch2="archf" data-k="client">${opt('', 'Todos los clientes', f.client)}${clientsOpt.map(([id, n]) => opt(id, n, f.client)).join('')}</select>
    <select class="select mini" style="width:auto" data-ch2="archf" data-k="cat">${opt('', 'Todas las categorías', f.cat)}${catsOpt.map(([id, n]) => opt(id, n, f.cat)).join('')}</select>
    <input class="input mini" style="max-width:240px" data-ch2="archf" data-k="q" value="${esc(f.q)}" placeholder="Buscar en ${shortMonth(m)}…">
    <span class="muted small">${list.length} de ${d.done.length}</span>
  </div>
  <div class="card" style="padding:6px 10px">${rows || emptyBox('Sin tareas con estos filtros', 'archive')}</div>
  ${d.pending.length ? `<div class="section-title">Pendientes que pasaron a ${S.monthLabel(monthAdd(m, 1))} · ${d.pending.length}<span class="sp"></span></div>
    <div class="card" style="padding:6px 10px">${d.pending.map(p => `<div class="arow" ${S.getTask(p.id) ? `data-act="open" data-id="${p.id}"` : ''}><span class="code">${esc(p.code)}</span><span class="t">${esc(p.title)}</span><span class="cchip a-hide"><i class="cdot" style="background:${esc(S.refClientColor(p))}"></i><span class="n">${esc(S.refClientName(p))}</span></span><span class="a-hide small">${p.dueDate ? 'Vence ' + fmtDate(p.dueDate) : 'Sin fecha'}</span><span class="a-hide"></span><span class="small muted">${STATUS[p.status]?.label || ''}</span></div>`).join('')}</div>` : ''}`;
}

// Hoja de detalle en solo lectura (tarea archivada)
function renderArchSheet() {
  const { m, id } = ui.archTask || {};
  const a = S.getArchive(m); const t0 = a?.tasks.find(x => x.id === id);
  if (!t0) { closeSheet(); return; }
  const t = { ...t0, _refs: a };
  const ro = (label, val) => `<div class="field"><span>${label}</span><div class="ro">${val || '—'}</div></div>`;
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sheet-h"><span class="code">${esc(t.code)}</span><span class="status st-done" style="cursor:default">${icon('done')}Terminada</span><span class="lock-chip">${icon('lock')}Archivada · ${S.monthLabel(m)}</span>
    <span style="flex:1"></span><button class="icon-btn" data-act="close-sheet" title="Cerrar">${icon('close')}</button></div>
  <div class="sheet-b">
    <div class="sheet-title" style="padding:6px 0">${esc(t.title)}</div>
    <div class="props">
      ${ro('Cliente', `<span class="cchip"><i class="cdot" style="background:${esc(S.refClientColor(t))}"></i>${esc(S.refClientName(t))}</span>`)}
      ${ro('Categoría', esc(S.refCategoryName(t)))}
      ${ro('Prioridad', PRIORITY[t.priority] || '')}
      ${ro('Origen', { manual: 'Manual', recurring: 'Recurrente', gmail: 'Gmail', gtasks: 'Google Tasks' }[t.source] || t.source)}
      ${ro('Fecha límite', t.dueDate ? fmtDate(t.dueDate) + (t.dueTime ? ' · ' + fmtHM(t.dueTime) : '') : '')}
      ${ro('Resultado', S.wasLate(t) ? '<span class="late">Terminada tarde</span>' : '<span class="ontime">A tiempo</span>')}
    </div>
    <div class="stamps">
      <div class="stamp"><b>Ingresada</b><span>${fmtDateTime(t.createdAt)}</span></div>
      <div class="stamp"><b>Iniciada</b><span>${t.startedAt ? fmtDateTime(t.startedAt) : '—'}</span></div>
      <div class="stamp done-st"><b>Finalizada</b><span>${fmtDateTime(t.completedAt)}</span></div>
    </div>
    <div class="section-title">Notas<span class="sp"></span></div>
    <div class="ro-notes">${esc(t.notes) || '<span class="muted">Sin notas</span>'}</div>
    ${(t.subtasks || []).length ? `<div class="section-title">Subtareas · ${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}<span class="sp"></span></div>
      ${t.subtasks.map(s => `<div class="sub-row ${s.done ? 'done' : ''}"><span class="check ${s.done ? 'on' : ''}" style="cursor:default">${icon('check')}</span><span style="flex:1;${s.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(s.title)}</span>${s.doneAt ? `<span class="small muted">${fmtDate(ymd(new Date(s.doneAt)), false)}</span>` : ''}</div>`).join('')}` : ''}
    ${(t.links || []).length ? `<div class="section-title">Enlaces<span class="sp"></span></div>${t.links.map(l => `<div class="link-row"><span class="ficon f-${l.type}">${icon(typeIcon(l.type))}</span><div class="lt"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a><small>${esc(linkInfo(l.url).label)}</small></div></div>`).join('')}` : ''}
    ${(t.files || []).length ? `<div class="section-title">Archivos<span class="sp"></span></div>${t.files.map(f => `<div class="link-row"><span class="ficon f-${f.type}">${icon(typeIcon(f.type))}</span><div class="lt"><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a><small>${f.size ? fmtSize(f.size) : ''}</small></div></div>`).join('')}` : ''}
    <div class="section-title">Actividad<span class="sp"></span></div>
    ${(t.log || []).map(l => `<div class="logline"><time>${fmtDateTime(l.at)}</time><span>${esc(l.text)}</span></div>`).join('')}
    <div class="sheet-actions"><button class="btn tonal sm" data-act="arch-copy" data-m="${m}" data-id="${t.id}">${icon('copy', 'sm')}Usar como base para una tarea nueva</button></div>
  </div>`;
  sh.classList.add('on'); sh.setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on');
}

// ---------------------------------------------------------------- reporte PDF (vista de impresión con marca Vertikal)
function reportHtml(m, d) {
  const sum = summarize(d.done);
  const next = S.monthLabel(monthAdd(m, 1));
  const top = sum.clients[0], topCat = sum.cats[0];
  const lateP = pct(sum.late, sum.n);
  const summary = sum.n
    ? `En ${S.monthLabel(m)} se completaron <b>${pl(sum.n, 'tarea')}</b> para <b>${sum.clients.length} cliente${sum.clients.length === 1 ? '' : 's'}</b>. El cliente con más trabajo fue <b>${esc(top.name)}</b> con ${pl(top.n, 'tarea')} (${pct(top.n, sum.n)}%)${topCat ? `, y la categoría principal fue <b>${esc(topCat.name)}</b>` : ''}. El tiempo promedio de entrega, desde el ingreso hasta la finalización, fue de <b>${fmtDur(sum.avg)}</b>; ${sum.late ? `<b>${pl(sum.late, 'tarea')} (${lateP}%)</b> se terminaron después de su fecha límite` : 'todas se terminaron a tiempo'}. ${d.pending.length ? `${d.pending.length === 1 ? 'Quedó' : 'Quedaron'} <b>${pl(d.pending.length, 'tarea')} ${d.pending.length === 1 ? 'pendiente' : 'pendientes'}</b> que pasan a ${next}.` : 'No quedaron tareas pendientes.'}`
    : `En ${S.monthLabel(m)} no se registraron tareas terminadas.`;
  const done = [...d.done].sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''));
  const dt = iso => { const x = new Date(iso); return `${x.getDate()}/${x.getMonth() + 1} ${fmtTime(x)}`; };
  const dd = s => { if (!s) return '—'; const x = parseYmd(s); return `${x.getDate()}/${x.getMonth() + 1}`; };
  const base = location.href.split('#')[0].replace(/[^/]*$/, '');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de tareas · ${S.monthLabel(m)} · Vertikal</title>
<base href="${base}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page { size: letter; margin: 14mm 13mm 16mm; }
* { box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; font-weight: 400; color: #111433; margin: 0; font-size: 10.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
b, strong, th, h1, h2, h3 { font-weight: 700; }
.bar { position: sticky; top: 0; background: #F7F8FC; border-bottom: 1px solid #E2E5F0; padding: 10px 16px; display: flex; gap: 10px; align-items: center; z-index: 5; }
.bar button { font: inherit; font-weight: 700; font-size: 13px; border: 0; border-radius: 999px; padding: 9px 18px; background: #0065FF; color: #fff; cursor: pointer; }
.bar span { color: #4A5070; font-size: 12px; }
.page { max-width: 820px; margin: 0 auto; padding: 24px 16px; }
header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 12px; }
header img { height: 26px; }
header .r { text-align: right; }
header .r .k { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #747A99; font-weight: 600; }
header .r h1 { margin: 2px 0 0; font-size: 20px; color: #000A4F; letter-spacing: -.02em; text-transform: capitalize; }
.brandline { display: flex; height: 4px; border-radius: 2px; overflow: hidden; margin-bottom: 16px; }
.brandline i { flex: 1; } .brandline i:nth-child(1) { background: #FF5A3C; } .brandline i:nth-child(2) { background: #0065FF; flex: 2; } .brandline i:nth-child(3) { background: #00B864; }
.summary { background: #F1F3FA; border-radius: 12px; padding: 12px 14px; font-size: 11.5px; line-height: 1.6; margin-bottom: 14px; }
.summary .k { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: #0057E0; font-weight: 700; margin-bottom: 4px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
.kpi { border-radius: 12px; padding: 10px 12px; }
.kpi .l { font-size: 9.5px; font-weight: 600; opacity: .85; }
.kpi .v { font-size: 22px; font-weight: 700; letter-spacing: -.02em; }
.k1 { background: #000A4F; color: #fff; } .k2 { background: #DCE6FF; color: #001A55; } .k3 { background: #D6F5E5; color: #00502C; } .k4 { background: #FFE1DA; color: #5A1408; }
h2 { font-size: 12px; color: #000A4F; margin: 18px 0 8px; letter-spacing: .02em; text-transform: uppercase; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { background: #000A4F; color: #fff; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; text-align: left; padding: 6px 7px; }
th:first-child { border-radius: 8px 0 0 8px; } th:last-child { border-radius: 0 8px 8px 0; }
td { padding: 6px 7px; border-bottom: 1px solid #E8EBF5; vertical-align: top; }
tr { page-break-inside: avoid; }
tbody tr:nth-child(even) td { background: #F7F8FC; }
.code { color: #747A99; font-weight: 600; white-space: nowrap; }
.t { font-weight: 600; }
.cl { white-space: nowrap; } .cl i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
.nw { white-space: nowrap; }
.pill { display: inline-block; padding: 2px 7px; border-radius: 999px; font-weight: 700; font-size: 9px; white-space: nowrap; }
.ok { background: #D6F5E5; color: #00804A; } .late { background: #FFE2DE; color: #C8261A; } .pend { background: #E8EBF5; color: #4A5070; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.share { display: inline-block; width: 70px; height: 6px; border-radius: 3px; background: #E8EBF5; vertical-align: middle; margin-right: 6px; overflow: hidden; } .share i { display: block; height: 100%; background: #0065FF; }
.two { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #E2E5F0; display: flex; justify-content: space-between; color: #747A99; font-size: 9px; }
@media print { .bar { display: none; } .page { padding: 0; max-width: none; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">Guardar como PDF</button><span>En la ventana de impresión elige “Guardar como PDF”.</span></div>
<div class="page">
<header><img src="icons/logo.png" alt="Vertikal"><div class="r"><div class="k">Reporte mensual de tareas</div><h1>${S.monthLabel(m)}</h1></div></header>
<div class="brandline"><i></i><i></i><i></i></div>
<div class="summary"><div class="k">Resumen</div>${summary}</div>
<div class="kpis">
  <div class="kpi k1"><div class="l">Tareas terminadas</div><div class="v">${sum.n}</div></div>
  <div class="kpi k2"><div class="l">Entrega promedio</div><div class="v">${fmtDur(sum.avg)}</div></div>
  <div class="kpi k3"><div class="l">A tiempo</div><div class="v">${pct(sum.n - sum.late, sum.n)}%</div></div>
  <div class="kpi k4"><div class="l">Pasan a ${esc(next.split(' ')[0])}</div><div class="v">${d.pending.length}</div></div>
</div>
<div class="two">
<div><h2>Por cliente</h2><table><thead><tr><th>Cliente</th><th class="num">Tareas</th><th>Participación</th><th class="num">Prom.</th><th class="num">Tarde</th></tr></thead><tbody>
${sum.clients.map(c => `<tr><td class="cl"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</td><td class="num">${c.n}</td><td class="nw"><span class="share"><i style="width:${pct(c.n, sum.clients[0].n)}%"></i></span>${pct(c.n, sum.n)}%</td><td class="num nw">${fmtDur(c.avg)}</td><td class="num">${c.late}</td></tr>`).join('') || '<tr><td colspan="5">Sin datos</td></tr>'}
</tbody></table></div>
<div><h2>Por categoría</h2><table><thead><tr><th>Categoría</th><th class="num">Tareas</th><th class="num">%</th></tr></thead><tbody>
${sum.cats.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${c.n}</td><td class="num">${pct(c.n, sum.n)}%</td></tr>`).join('') || '<tr><td colspan="3">Sin datos</td></tr>'}
</tbody></table></div>
</div>
<h2>Tareas terminadas · ${sum.n}</h2>
<table><thead><tr><th>Código</th><th>Tarea</th><th>Cliente</th><th>Categoría</th><th>Ingresada</th><th>Límite</th><th>Finalizada</th><th>Estado</th></tr></thead><tbody>
${done.map(t => `<tr><td class="code">${esc(t.code)}</td><td class="t">${esc(t.title)}</td><td class="cl"><i style="background:${esc(S.refClientColor(t))}"></i>${esc(S.refClientName(t))}</td><td>${esc(S.refCategoryName(t))}</td><td class="nw">${dt(t.createdAt)}</td><td class="nw">${dd(t.dueDate)}</td><td class="nw">${dt(t.completedAt)}</td><td>${S.wasLate(t) ? '<span class="pill late">Tarde</span>' : '<span class="pill ok">A tiempo</span>'}</td></tr>`).join('') || '<tr><td colspan="8">Sin tareas terminadas</td></tr>'}
</tbody></table>
${d.pending.length ? `<h2>Pendientes que pasan a ${next} · ${d.pending.length}</h2>
<table><thead><tr><th>Código</th><th>Tarea</th><th>Cliente</th><th>Ingresada</th><th>Límite</th><th>Estado</th></tr></thead><tbody>
${d.pending.map(t => `<tr><td class="code">${esc(t.code)}</td><td class="t">${esc(t.title)}</td><td class="cl"><i style="background:${esc(S.refClientColor(t))}"></i>${esc(S.refClientName(t))}</td><td class="nw">${dt(t.createdAt)}</td><td class="nw">${dd(t.dueDate)}</td><td><span class="pill pend">${STATUS[t.status]?.label || ''}</span></td></tr>`).join('')}
</tbody></table>` : ''}
<footer><span>Vertikal · Reporte generado el ${fmtDateTime(new Date().toISOString())}</span><span>${esc(CFG.USER_NAME || '')}</span></footer>
</div>
<script>document.fonts.ready.then(function(){ var im=document.querySelector('header img'); var go=function(){ setTimeout(function(){ window.print(); }, 350); }; if (im.complete) go(); else { im.onload=go; im.onerror=go; } });</script>
</body></html>`;
}

function openReport(m, win) {
  const d = monthData(m);
  if (d.missing) { snack('Conecta Google para descargar este mes archivado'); win?.close(); return; }
  win = win || window.open('', '_blank');
  if (!win) { snack('Permite las ventanas emergentes para generar el PDF'); return; }
  win.document.open(); win.document.write(reportHtml(m, d)); win.document.close();
}

// ---------------------------------------------------------------- exportar a Google Sheets (formato CM NOTES)
async function sheetExport(m) {
  if (!auth.linked) { snack('Conecta tu cuenta de Google para exportar a Sheets', 'Conectar', connect); return; }
  const win = window.open('', '_blank');
  try {
    if (!auth.valid) await signIn(true);
    const list = S.allKnownTasks().filter(t => S.taskMonth(t) === m).sort((a, b) => a.code.localeCompare(b.code));
    const safe = v => /^[=+\-@]/.test(v || '') ? "'" + v : (v || '');
    const dstr = iso => { const x = new Date(iso); return `${ymd(x)} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}:00`; };
    const prio = t => t.status === 'done' ? 'Done' : ({ high: 'High', normal: 'Normal', low: 'Low' }[t.priority] || 'Normal');
    const stat = t => ({ pending: 'Pending', progress: 'In progress', following: 'Following', done: 'Finished', inbox: 'Inbox' }[t.status] || '');
    const header = ['COD', 'TASK', 'CLIENT', 'CATEGORY', 'PRIORITY', 'STATUS', 'DUE DATE', 'DELIVERY', 'NOTES', 'ASSIGNED', 'FINISHED AT'];
    const rows = list.map(t => {
      const l = (t.links || [])[0] || (t.files || [])[0];
      const del = l ? `=HYPERLINK("${String(l.url).replace(/"/g, '%22')}","${String(l.title || l.name || 'Enlace').replace(/"/g, '""')}")` : '';
      return [t.code, safe(t.title), S.refClientName(t), S.refCategoryName(t) === 'Sin categoría' ? '' : S.refCategoryName(t), prio(t), stat(t), t.dueDate || '', del, safe((t.notes || '').slice(0, 2000)), ymd(new Date(t.createdAt)), t.completedAt ? dstr(t.completedAt) : ''];
    });
    const names = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    snack('Creando la hoja en tu Google Drive…');
    const mon = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'][Number(m.slice(5, 7)) - 1];
    const url = await exportToSheet({
      title: `CM NOTES · ${S.monthLabel(m)}`, sheetTitle: `T - ${mon}`, header, rows,
      validations: { CLIENT: names([...S.clients().map(c => c.name), ...rows.map(r => r[2])]), CATEGORY: names([...S.categories().map(c => c.name), ...rows.map(r => r[3])]), PRIORITY: ['High', 'Normal', 'Low', 'Done'], STATUS: ['Pending', 'In progress', 'Following', 'Finished', 'Inbox'] },
      folderName: 'Vertikal CRM · Exportaciones'
    });
    if (win) win.location.href = url; else snack('Hoja creada', 'Abrir', () => window.open(url, '_blank'));
    snack(`Hoja de ${S.monthLabel(m)} creada en Drive › Vertikal CRM · Exportaciones`);
  } catch (e) {
    win?.close();
    snack(/sheets\.googleapis|disabled|has not been used/i.test(e.message) ? 'Falta habilitar la API de Google Sheets en el proyecto de Google Cloud' : 'No se pudo exportar: ' + e.message);
  }
}

// ---------------------------------------------------------------- MI SEMANA
const weekStartOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return ymd(x); };
async function loadWeekEvents(ws) {
  if (!auth.valid || ui.weekEvents[ws]?.loading) return;
  ui.weekEvents[ws] = { loading: true, items: ui.weekEvents[ws]?.items || [] };
  try { const min = parseYmd(ws); const items = await listEventsRange(min, addDays(min, 7)); ui.weekEvents[ws] = { items, at: Date.now() }; }
  catch { ui.weekEvents[ws] = { items: [], at: Date.now(), err: true }; }
  if (ui.route === 'week' && ui.weekStart === ws) { $('#view').innerHTML = viewWeek(); }
}
function weekCard(t) {
  const done = t.status === 'done', over = S.isOverdue(t);
  return `<div class="wcard ${done ? 'is-done' : ''} ${over ? 'is-over' : ''}" data-act="open" data-id="${t.id}" style="--c:${esc(cColor(t.clientId))}">
    <span class="grip" data-ghost title="Arrastra a otro día">${icon('grip', 'sm')}</span>
    <button class="check ${done ? 'on' : ''}" data-act="toggle" data-id="${t.id}" aria-label="Completar">${icon('check')}</button>
    <div><div class="wt">${t.priority === 'high' ? `<span class="prio-high">${icon('flag', 'xs')}</span> ` : ''}${esc(t.title)}</div>
    <div class="wm"><i class="cdot" style="background:${esc(cColor(t.clientId))}"></i>${esc(S.clientName(t.clientId))}${t.dueTime && !done ? ` · <span class="tm">${fmtHM(t.dueTime)}</span>` : ''}${done && t.completedAt ? ` · ${fmtTime(new Date(t.completedAt))}` : ''}${t.status === 'progress' ? ' · En desarrollo' : ''}</div></div></div>`;
}
function viewWeek() {
  if (!ui.weekStart) ui.weekStart = weekStartOf(new Date());
  const ws = ui.weekStart, start = parseYmd(ws);
  const days = [...Array(7)].map((_, i) => ymd(addDays(start, i)));
  const today = todayStr(), all = S.tasks();
  const ev = ui.weekEvents[ws];
  if (auth.valid && (!ev || (!ev.loading && Date.now() - (ev.at || 0) > 5 * 60e3))) loadWeekEvents(ws);
  const older = all.filter(t => S.isOverdue(t) && t.dueDate < days[0]).sort(S.orderCmp);
  const noDate = all.filter(t => S.isOpen(t) && !t.dueDate).sort(S.orderCmp);
  const end = addDays(start, 6);
  const range = start.getMonth() === end.getMonth() ? `${start.getDate()} al ${end.getDate()} de ${S.monthLabel(ym(end))}` : `${start.getDate()} ${shortMonth(ym(start))} al ${end.getDate()} ${shortMonth(ym(end))} ${end.getFullYear()}`;
  const openWeek = all.filter(t => S.isOpen(t) && days.includes(t.dueDate)).length;
  const doneWeek = all.filter(t => t.status === 'done' && t.completedAt && days.includes(ymd(new Date(t.completedAt)))).length;
  const evFor = d => (ev?.items || []).filter(e => ymd(e.start.dateTime ? new Date(e.start.dateTime) : parseYmd(e.start.date)) === d);
  return `<div class="week-h">
    <h2>Semana del ${range}</h2>
    <div class="seg"><button data-act="week-nav" data-v="-1" aria-label="Semana anterior">${icon('left', 'sm')}</button><button data-act="week-nav" data-v="0" class="${ws === weekStartOf(new Date()) ? 'on' : ''}">Hoy</button><button data-act="week-nav" data-v="1" aria-label="Semana siguiente">${icon('right', 'sm')}</button></div>
    <span class="sp" style="flex:1"></span><span class="muted small">${openWeek} pendientes · ${doneWeek} terminadas</span>
    <button class="btn outlined sm" data-act="meet-new">${icon('video', 'sm')}Reunión</button>
  </div>
  ${older.length ? `<div class="wstrip" data-drop-day="__keep"><h4 style="color:var(--error)">${icon('alert', 'sm')}Atrasadas de semanas anteriores · ${older.length}<span class="muted small" style="font-weight:400">Arrástralas a un día</span></h4><div class="list">${older.map(weekCard).join('')}</div></div>` : ''}
  ${noDate.length ? `<div class="wstrip"><h4>${icon('clock', 'sm')}Sin fecha · ${noDate.length}<span class="muted small" style="font-weight:400">Arrástralas a un día para programarlas</span></h4><div class="list">${noDate.map(weekCard).join('')}</div></div>` : ''}
  <div class="week">${days.map(d => {
    const dt = parseYmd(d);
    const list = all.filter(t => S.isOpen(t) && t.dueDate === d).sort(S.orderCmp);
    const done = all.filter(t => S.doneOn(t, d)).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    const evs = evFor(d);
    return `<div class="wday ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}" data-drop-day="${d}">
      <div class="wday-h"><span class="n">${dt.getDate()}</span><b>${fmtLongDate(dt).split(' ')[0]}</b><span class="sp"></span><span class="count">${list.length}${done.length ? ' · ' + done.length + ' ✓' : ''}</span></div>
      ${evs.map(e => `<a class="wev" href="${esc(e.htmlLink)}" target="_blank" rel="noopener"><time>${e.start.dateTime ? fmtTime(new Date(e.start.dateTime)) : 'Todo el día'}</time><b>${esc(e.summary || '(Sin título)')}</b></a>`).join('')}
      ${list.map(weekCard).join('')}
      ${done.map(weekCard).join('')}
      <button class="wadd" data-act="new-on-day" data-d="${d}">${icon('plus', 'xs')} Tarea</button>
    </div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- ESTADÍSTICAS
function statsRange(p) {
  const now = new Date(); const cur = ym(now);
  if (p === 'month') return { from: cur, to: cur, label: S.monthLabel(cur) };
  if (p === 'prev') { const m = monthAdd(cur, -1); return { from: m, to: m, label: S.monthLabel(m) }; }
  if (p === '3m') return { from: monthAdd(cur, -2), to: cur, label: 'Últimos 3 meses' };
  if (p === 'year') return { from: `${now.getFullYear()}-01`, to: cur, label: String(now.getFullYear()) };
  if (p === 'all') return { from: '0000-00', to: '9999-99', label: 'Todo el historial' };
  const m = p.slice(2); return { from: m, to: m, label: S.monthLabel(m) };
}
function viewStats() {
  const r = statsRange(ui.statsPeriod);
  const all = S.allKnownTasks();
  const inRange = iso => { const m = ym(new Date(iso)); return m >= r.from && m <= r.to; };
  const done = all.filter(t => t.status === 'done' && t.completedAt && inRange(t.completedAt));
  const sum = summarize(done);
  const active = S.tasks();
  const openBy = name => active.filter(t => S.isOpen(t) && S.clientName(t.clientId) === name);
  const overNow = active.filter(t => S.isOverdue(t));
  const top = sum.clients[0];
  const lateTop = [...sum.clients].sort((a, b) => b.late - a.late)[0];
  const missing = S.archivedMonths().filter(m => !S.getArchive(m));
  const clientNames = new Set([...sum.clients.map(c => c.name), ...active.filter(S.isOpen).map(t => S.clientName(t.clientId))]);
  const clientRows = [...clientNames].map(name => {
    const c = sum.clients.find(x => x.name === name) || { name, n: 0, late: 0, avg: null, color: S.clients(true).find(x => x.name === name)?.color || '#5B6B8C' };
    const o = openBy(name); return { ...c, open: o.length, overdue: o.filter(t => S.isOverdue(t)).length };
  }).sort((a, b) => b.n - a.n || b.open - a.open);
  const maxN = Math.max(1, ...clientRows.map(c => c.n));
  const periods = [['month', 'Este mes'], ['prev', 'Mes anterior'], ['3m', 'Últimos 3 meses'], ['year', 'Este año'], ['all', 'Todo'], ...S.archivedMonths().map(m => ['m:' + m, S.monthLabel(m)])];
  return `<div class="toolbar"><select class="select mini" style="width:auto" data-ch2="stats">${periods.map(([k, l]) => opt(k, l, ui.statsPeriod)).join('')}</select>
    <span class="muted small">${r.label} · tareas terminadas en el periodo${missing.length ? ` · ${missing.length} mes(es) archivados se descargan al sincronizar` : ''}</span></div>
  ${top ? `<div class="callout">${icon('chart')}<div>El cliente que más consume en ${r.label.toLowerCase().startsWith('todo') ? 'todo el historial' : r.label} es <b>${esc(top.name)}</b>: ${pl(top.n, 'tarea')} (${pct(top.n, sum.n)}%) con entrega promedio de ${fmtDur(top.avg)}.${lateTop && lateTop.late ? ` Más atrasos: <b>${esc(lateTop.name)}</b> (${lateTop.late}).` : ''}</div></div>` : ''}
  <div class="stiles">
    <div class="stile"><div class="lbl">Terminadas</div><div class="val">${sum.n}</div><div class="sub">${sum.clients.length} clientes · ${sum.cats.length} categorías</div></div>
    <div class="stile"><div class="lbl">Entrega promedio</div><div class="val">${fmtDur(sum.avg)}</div><div class="sub">del ingreso a la finalización</div></div>
    <div class="stile"><div class="lbl">A tiempo</div><div class="val">${sum.n ? pct(sum.n - sum.late, sum.n) + '%' : '—'}</div><div class="sub">${sum.n - sum.late} de ${sum.n}</div></div>
    <div class="stile"><div class="lbl">Terminadas tarde</div><div class="val" style="color:var(--error)">${sum.late}</div><div class="sub">después de su fecha límite</div></div>
    <div class="stile"><div class="lbl">Atrasadas hoy</div><div class="val">${overNow.length}</div><div class="sub">${active.filter(S.isOpen).length} abiertas en total</div></div>
  </div>
  <div class="grid dash">
    <section class="card span-8"><div class="card-h"><h3>${icon('clients', 'sm')}Por cliente</h3></div><div class="table-wrap"><table class="stable">
      <thead><tr><th>Cliente</th><th class="num">Terminadas</th><th>Participación</th><th class="num">Prom. entrega</th><th class="num">Tarde</th><th class="num">Abiertas</th><th class="num">Atrasadas hoy</th></tr></thead>
      <tbody>${clientRows.map(c => `<tr><td><span class="cchip"><i class="cdot" style="background:${esc(c.color)}"></i>${esc(c.name)}</span></td><td class="num"><b>${c.n}</b></td>
        <td><div class="share"><span class="track"><span class="fill" style="display:block;width:${c.n / maxN * 100}%"></span></span><span class="small">${pct(c.n, sum.n)}%</span></div></td>
        <td class="num">${fmtDur(c.avg)}</td><td class="num ${c.late ? 'late' : ''}">${c.late}${c.n ? ` <span class="muted small">(${pct(c.late, c.n)}%)</span>` : ''}</td><td class="num">${c.open}</td><td class="num ${c.overdue ? 'late' : ''}">${c.overdue}</td></tr>`).join('') || `<tr><td colspan="7">${emptyBox('Sin datos en este periodo', 'chart')}</td></tr>`}</tbody></table></div></section>
    <section class="card span-4"><div class="card-h"><h3>${icon('tasks', 'sm')}Por categoría</h3></div><div class="table-wrap"><table class="stable">
      <thead><tr><th>Categoría</th><th class="num">Terminadas</th><th class="num">Prom.</th><th class="num">Tarde</th></tr></thead>
      <tbody>${sum.cats.map(c => `<tr><td>${esc(c.name)}</td><td class="num"><b>${c.n}</b> <span class="muted small">${pct(c.n, sum.n)}%</span></td><td class="num">${fmtDur(c.avg)}</td><td class="num ${c.late ? 'late' : ''}">${c.late}</td></tr>`).join('') || `<tr><td colspan="4">${emptyBox('Sin datos', 'chart')}</td></tr>`}</tbody></table></div></section>
  </div>`;
}

// ---------------------------------------------------------------- arrastre con puntero (mouse y táctil)
let pd = null;
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('[data-grip],[data-ghost]'); if (!g || e.button > 0) return;
  const item = g.closest('[data-id]'); if (!item) return;
  e.preventDefault();
  ui.suppressUntil = Date.now() + 10e3;
  if (g.hasAttribute('data-grip')) {
    const list = item.parentElement; if (!list?.hasAttribute('data-sort')) return;
    pd = { mode: 'sort', item, list, moved: false };
    item.classList.add('sorting');
  } else {
    const r = item.getBoundingClientRect();
    const ghost = item.cloneNode(true); ghost.classList.add('ghost');
    Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
    document.body.appendChild(ghost);
    pd = { mode: 'move', item, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, target: null };
    item.classList.add('dragging');
  }
  try { g.setPointerCapture(e.pointerId); } catch {}
});
document.addEventListener('pointermove', e => {
  if (!pd) return;
  e.preventDefault();
  if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > innerHeight - 90) window.scrollBy(0, 14);
  if (pd.mode === 'sort') {
    const sibs = [...pd.list.children].filter(c => c !== pd.item && c.dataset.id);
    const before = sibs.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (before) { if (pd.item.nextElementSibling !== before) { pd.list.insertBefore(pd.item, before); pd.moved = true; } }
    else if (pd.list.lastElementChild !== pd.item) { pd.list.appendChild(pd.item); pd.moved = true; }
  } else {
    pd.ghost.style.left = (e.clientX - pd.dx) + 'px'; pd.ghost.style.top = (e.clientY - pd.dy) + 'px';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const tgt = el?.closest('[data-drop],[data-drop-day]') || null;
    if (tgt !== pd.target) { pd.target?.classList.remove('drop'); tgt?.classList.add('drop'); pd.target = tgt; }
  }
}, { passive: false });
function endPointerDrag() {
  if (!pd) return;
  const d = pd; pd = null;
  ui.suppressUntil = Date.now() + 350;
  if (d.mode === 'sort') {
    d.item.classList.remove('sorting');
    if (d.moved) { S.setOrder([...d.list.children].map(c => c.dataset.id).filter(Boolean)); commit(); }
    return;
  }
  d.ghost.remove(); d.item.classList.remove('dragging');
  const t = d.target; t?.classList.remove('drop');
  if (!t) return;
  const id = d.item.dataset.id;
  if (t.dataset.dropDay && t.dataset.dropDay !== '__keep') {
    if (S.getTask(id)?.dueDate !== t.dataset.dropDay) { S.updateTask(id, { dueDate: t.dataset.dropDay }); commit(); snack(`Movida al ${fmtDate(t.dataset.dropDay)}`); }
  } else if (t.dataset.drop) { S.updateTask(id, { status: t.dataset.drop }); commit(); }
}
document.addEventListener('pointerup', endPointerDrag);
document.addEventListener('pointercancel', endPointerDrag);

// ---------------------------------------------------------------- acciones y cambios nuevos
Object.assign(ACTIONS, {
  'archive-month': el => archiveDialog(el.dataset.m),
  report: el => openReport(el.dataset.m),
  'sheet-export': el => sheetExport(el.dataset.m),
  'arch-open': el => { ui.openId = null; ui.archTask = { m: el.dataset.m, id: el.dataset.id }; renderArchSheet(); },
  'arch-copy': el => {
    const a = S.getArchive(el.dataset.m); const t = a?.tasks.find(x => x.id === el.dataset.id); if (!t) return;
    const n = S.addTask({ title: t.title, clientId: S.getClient(t.clientId) ? t.clientId : null, categoryId: S.getCategory(t.categoryId) ? t.categoryId : null, priority: t.priority, status: 'pending', dueDate: todayStr(), notes: t.notes, links: structuredClone(t.links || []), logText: `Creada a partir de ${t.code} (archivo de ${S.monthLabel(el.dataset.m)})` });
    n.subtasks = (t.subtasks || []).map(s => ({ ...s, id: uid(), done: false, doneAt: null }));
    commit(); ui.archTask = null; openTask(n.id); snack(`Tarea ${n.code} creada a partir de ${t.code}`);
  },
  'week-nav': el => { const v = Number(el.dataset.v); ui.weekStart = v === 0 ? weekStartOf(new Date()) : ymd(addDays(parseYmd(ui.weekStart || weekStartOf(new Date())), 7 * v)); $('#view').innerHTML = viewWeek(); },
  'new-on-day': el => taskDialog({ dueDate: el.dataset.d })
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-ch2]'); if (!el) return;
  if (el.dataset.ch2 === 'stats') { ui.statsPeriod = el.value; render(); }
  if (el.dataset.ch2 === 'archf') { ui.archF[el.dataset.k] = el.value; render(); }
});
document.addEventListener('input', debounce(e => {
  const el = e.target.closest?.('[data-ch2="archf"][data-k="q"]'); if (!el) return;
  ui.archF.q = el.value; render();
  const n = $('[data-ch2="archf"][data-k="q"]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
}, 250));


// ---------------------------------------------------------------- arranque
function boot() {
  applyTheme();
  store.load();
  const mig = S.migrateCodes();
  const rec = S.autoRecurring();
  const abs = S.absorbStragglers();
  if (rec.n || mig || abs) store.persist(true);
  parseHash();
  render();
  if (rec.n) snack(`${rec.n} tareas recurrentes generadas`);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').then(() => { if (window.Notification?.permission === 'granted') registerPeriodic(); }).catch(() => {});
  if (auth.valid) { syncAll({ reason: 'boot' }); }
  else if (auth.linked) {
    renderAccount();
    // Al primer clic se renueva la sesión de Google sin pedir datos otra vez
    document.addEventListener('click', function once(e) {
      if (auth.valid || e.target.closest('[data-act=disconnect]')) return document.removeEventListener('click', once, true);
      document.removeEventListener('click', once, true);
      signIn(true).then(() => { syncAll({ reason: 'auto-reconnect' }); loadEvents(true); }).catch(() => {});
    }, true);
  }
  setInterval(() => { checkOverdue(); if (document.visibilityState === 'visible' && auth.valid) syncAll({ reason: 'interval' }); }, 90e3);
  setInterval(() => { if (ui.route === 'dashboard' && !document.querySelector('#view :focus')) { $('#view').innerHTML = viewDashboard(); } }, 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkOverdue(); if (auth.valid) syncAll({ reason: 'visible' }); } });
  checkOverdue();
  window.VK = { store, S, syncAll }; // depuración
}
boot();
