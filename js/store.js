// Estado, persistencia local, fusión entre dispositivos y lógica de negocio
import { uid, todayStr, ymd, ym, parseYmd, lastDayOfMonth, monthAdd, parseCSV, linkInfo } from './util.js';

const LS_KEY = 'vkcrm.data.v1';
export const COLLECTIONS = ['clients', 'categories', 'tasks', 'recurring', 'quick'];

export const STATUS = {
  inbox: { label: 'Inbox', icon: 'inbox' },
  pending: { label: 'Pendiente', icon: 'clock' },
  progress: { label: 'En desarrollo', icon: 'progress' },
  following: { label: 'Seguimiento', icon: 'eye' },
  done: { label: 'Terminada', icon: 'done' }
};
export const BOARD_STATUSES = ['pending', 'progress', 'following', 'done'];
export const PRIORITY = { high: 'Alta', normal: 'Normal', low: 'Baja' };
export const CLIENT_COLORS = ['#0065FF', '#FF5A3C', '#00B864', '#7A3CFF', '#FF9F1C', '#00A3C4', '#E0347E', '#5B6B8C', '#2E7D32', '#B5651D', '#3949AB', '#00897B'];

const now = () => new Date().toISOString();
const stamp = o => { o.updatedAt = Date.now(); return o; };

function emptyState() {
  return {
    schema: 1, seq: 0, settingsUpdatedAt: 0,
    clients: [], categories: [], tasks: [], recurring: [], quick: [],
    settings: { syncAheadDays: 0, notify: true, recurringGenerated: {}, gtListId: null }
  };
}

// ---------- Datos iniciales (tomados de CM NOTES 2026) ----------
function seedState() {
  const s = emptyState();
  const T = Date.now();
  const clients = ['Marketing VTK', 'Social Media VTK', 'BlueSky', 'Smile by Dr. Donan', 'Sistemas El Salvador', 'UJMD', 'Fráter', 'Cavalier', 'Vortex', 'Pluma Verde', 'TIG FIT 100', 'Interno'];
  s.clients = clients.map((name, i) => ({ id: 'seed-c' + i, name, color: CLIENT_COLORS[i % CLIENT_COLORS.length], notes: '', archived: false, updatedAt: T }));
  const cats = ['Social Media', 'Contenido', 'Reportes', 'Proyectos', 'Mantenimiento', 'Planificación', 'Comunicación', 'Monitoreo'];
  s.categories = cats.map((name, i) => ({ id: 'seed-k' + i, name, updatedAt: T }));
  const C = n => s.clients.find(c => c.name === n).id;
  const K = n => s.categories.find(c => c.name === n).id;

  const rec = [
    ['Subir contenido Social Media', 'Social Media VTK', 'Social Media', [3, 7, 10, 14, 17, 21, 24, 28]],
    ['Crear contenido Social Media', 'Social Media VTK', 'Social Media', [2]],
    ['Subir Linkedin', 'Social Media VTK', 'Social Media', [6, 13, 20, 27]],
    ['Status de keywords', 'Marketing VTK', 'Reportes', [7, 14, 21, 28]],
    ['Seguimiento a avances de Marketing', 'Marketing VTK', 'Monitoreo', [4, 9, 14, 19, 24, 28]],
    ['Subir Blog', 'Sistemas El Salvador', 'Contenido', [5, 11, 17, 23, 28]],
    ['Trabajar blogs', 'Sistemas El Salvador', 'Contenido', [3]],
    ['Trabajar blogs', 'BlueSky', 'Contenido', [3]],
    ['Crear Reporte', 'Cavalier', 'Reportes', [22]],
    ['Enviar Reporte', 'Cavalier', 'Reportes', [26]],
    ['Crear Reporte', 'BlueSky', 'Reportes', [22]],
    ['Enviar Reporte', 'BlueSky', 'Reportes', [26]]
  ];
  s.recurring = rec.map((r, i) => ({ id: 'seed-r' + i, title: r[0], clientId: C(r[1]), categoryId: K(r[2]), priority: 'normal', days: r[3], time: '', notes: '', active: true, updatedAt: T }));

  const tasks = [
    ['Seguimiento a avances de Marketing', 'Marketing VTK', 'Social Media', 'normal', 'pending', '2026-10-29', '2026-10-20', 'Marketing Pipeline 2026 - VertikalSV'],
    ['Trabajar blogs', 'BlueSky', 'Contenido', 'normal', 'pending', '2026-10-29', '2026-10-20'],
    ['Crear contenido Social Media', 'Social Media VTK', 'Social Media', 'normal', 'pending', '2026-10-29', '2026-10-20'],
    ['Enviar reporte Analytics nuevo', 'Smile by Dr. Donan', 'Reportes', 'high', 'following', '2026-10-29', '2026-10-20'],
    ['Subir Blog Sistemas El Salvador', 'Sistemas El Salvador', 'Contenido', 'normal', 'pending', '2026-10-28', '2026-10-20'],
    ['Crear cuenta de Instagram de Páginas Web', 'Social Media VTK', 'Social Media', 'normal', 'pending', '2026-10-28', '2026-10-20'],
    ['Consultar sobre avances de contenido Instagram', 'Social Media VTK', 'Social Media', 'normal', 'pending', '2026-10-28', '2026-10-26'],
    ['Asignar tareas en el Portal (Fase 2)', 'TIG FIT 100', 'Mantenimiento', 'normal', 'pending', '2026-11-20', '2026-10-21']
  ];
  s.tasks = tasks.map((t, i) => {
    const task = newTaskObj({ title: t[0], clientId: C(t[1]), categoryId: K(t[2]), priority: t[3], status: t[4], dueDate: t[5], notes: t[7] ? 'Entregable: ' + t[7] : '' });
    task.id = 'seed-t' + i; task.code = 'T' + String(i + 1).padStart(3, '0');
    task.createdAt = new Date(parseYmd(t[6]).setHours(9, 0)).toISOString();
    task.log = [{ at: task.createdAt, text: 'Importada desde CM NOTES 2026' }];
    return task;
  });
  s.seq = tasks.length;
  s.quick = [
    ['Calendario Cavalier', 'Monthly Calendar - CAVALIER', 'sheet'],
    ['Calendario Sistemas El Salvador', 'Monthly Calendar 2026 - Sistemas El Salvador', 'sheet'],
    ['Calendario Smiles By Dr Donan', 'Monthly Calendar - Smiles By Dr Donan', 'sheet'],
    ['Calendario Sonrie', 'Monthly Calendar - Sonrie', 'sheet'],
    ['Reportes Cavalier', 'Monthly SEO Reports Cavalier', 'folder'],
    ['Marketing', 'MARKETING', 'folder'],
    ['Social Media', 'SOCIAL MEDIA', 'folder']
  ].map((q, i) => ({ id: 'seed-q' + i, title: q[0], url: '', type: q[2], hint: 'Pega el enlace de "' + q[1] + '"', updatedAt: T }));
  s.settings.recurringGenerated = { [ym(new Date())]: true };
  s.settingsUpdatedAt = T;
  return s;
}

export function newTaskObj(p = {}) {
  return {
    id: uid(), code: '', title: p.title || '', clientId: p.clientId || null, categoryId: p.categoryId || null,
    priority: p.priority || 'normal', status: p.status || 'pending',
    dueDate: p.dueDate || '', dueTime: p.dueTime || '',
    createdAt: now(), startedAt: p.status === 'progress' ? now() : null, completedAt: p.status === 'done' ? now() : null,
    notes: p.notes || '', subtasks: [], links: p.links || [], files: [], log: [],
    source: p.source || 'manual', recurringId: p.recurringId || null,
    gtaskId: null, gtStatus: null, deleted: false, updatedAt: Date.now()
  };
}

// ---------- Store ----------
const listeners = new Set();
export const store = {
  state: null,
  dirty: false,
  load() {
    try { const raw = localStorage.getItem(LS_KEY); this.state = raw ? normalize(JSON.parse(raw)) : seedState(); }
    catch { this.state = seedState(); }
    this.persist(false);
  },
  persist(markDirty = true) {
    if (markDirty) this.dirty = true;
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); } catch (e) { console.warn('No se pudo guardar localmente', e); }
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(meta) { listeners.forEach(fn => fn(meta)); },
  commit(meta = {}) { this.persist(true); this.emit(meta); },
  replace(next) { this.state = normalize(next); this.persist(false); this.emit({ remote: true }); }
};

function normalize(s) {
  const base = emptyState();
  const out = { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
  COLLECTIONS.forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
  out.tasks.forEach(t => { t.subtasks ||= []; t.links ||= []; t.files ||= []; t.log ||= []; });
  return out;
}

// Fusión por registro (gana el updatedAt más reciente); los borrados son lápidas
export function mergeStates(a, b) {
  if (!b) return a; if (!a) return normalize(b);
  const out = { ...a };
  COLLECTIONS.forEach(k => {
    const m = new Map();
    for (const x of [...(a[k] || []), ...(b[k] || [])]) {
      const p = m.get(x.id);
      if (!p || (x.updatedAt || 0) > (p.updatedAt || 0)) m.set(x.id, x);
    }
    out[k] = [...m.values()];
  });
  out.seq = Math.max(a.seq || 0, b.seq || 0);
  if ((b.settingsUpdatedAt || 0) > (a.settingsUpdatedAt || 0)) { out.settings = { ...a.settings, ...b.settings }; out.settingsUpdatedAt = b.settingsUpdatedAt; }
  out.settings.recurringGenerated = { ...(a.settings.recurringGenerated || {}), ...(b.settings?.recurringGenerated || {}) };
  return normalize(out);
}
export const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Selectores ----------
const S = () => store.state;
export const alive = arr => arr.filter(x => !x.deleted);
export const clients = (all = false) => alive(S().clients).filter(c => all || !c.archived).sort((a, b) => a.name.localeCompare(b.name, 'es'));
export const categories = () => alive(S().categories).sort((a, b) => a.name.localeCompare(b.name, 'es'));
export const tasks = () => alive(S().tasks);
export const getTask = id => S().tasks.find(t => t.id === id && !t.deleted);
export const getClient = id => S().clients.find(c => c.id === id);
export const getCategory = id => S().categories.find(c => c.id === id);
export const clientName = id => getClient(id)?.name || 'Sin cliente';
export const categoryName = id => getCategory(id)?.name || '';

export function dueMs(t) {
  if (!t.dueDate) return null;
  const d = parseYmd(t.dueDate);
  if (t.dueTime) { const [h, m] = t.dueTime.split(':').map(Number); d.setHours(h, m, 0, 0); }
  else d.setHours(23, 59, 59, 999);
  return d.getTime();
}
export const isOpen = t => t.status !== 'done' && t.status !== 'inbox';
export const isOverdue = (t, at = Date.now()) => isOpen(t) && t.dueDate && dueMs(t) < at;
export const isToday = t => t.dueDate === todayStr();
export const doneOn = (t, dayStr) => t.status === 'done' && t.completedAt && ymd(new Date(t.completedAt)) === dayStr;

// ---------- Mutaciones ----------
function log(t, text) { t.log.unshift({ at: now(), text }); if (t.log.length > 60) t.log.length = 60; }

export function addTask(p) {
  const t = newTaskObj(p);
  if (p.id) t.id = p.id;
  if (p.createdAt) t.createdAt = p.createdAt;
  S().seq = (S().seq || 0) + 1;
  t.code = 'T' + String(S().seq).padStart(3, '0');
  log(t, p.logText || 'Tarea creada');
  if (p.gtaskId) { t.gtaskId = p.gtaskId; t.gtStatus = p.gtStatus || null; }
  S().tasks.push(t);
  return t;
}

export function updateTask(id, patch, silent = false) {
  const t = getTask(id); if (!t) return null;
  if (patch.status && patch.status !== t.status) {
    const from = STATUS[t.status]?.label, to = STATUS[patch.status]?.label;
    if (patch.status === 'done') t.completedAt = patch.completedAt || now();
    else if (t.status === 'done') t.completedAt = null;
    if (patch.status === 'progress' && !t.startedAt) t.startedAt = now();
    if (!silent) log(t, `Estado: ${from} → ${to}`);
  }
  if ('dueDate' in patch && patch.dueDate !== t.dueDate && !silent) log(t, `Fecha límite: ${patch.dueDate || 'sin fecha'}`);
  const { completedAt, ...rest } = patch;
  Object.assign(t, rest);
  stamp(t);
  return t;
}
export const toggleDone = id => { const t = getTask(id); return updateTask(id, { status: t.status === 'done' ? (t.startedAt ? 'progress' : 'pending') : 'done' }); };
export function deleteTask(id) { const t = getTask(id); if (t) { t.deleted = true; stamp(t); } }
export function duplicateTask(id) {
  const t = getTask(id); if (!t) return null;
  return addTask({ title: t.title + ' (copia)', clientId: t.clientId, categoryId: t.categoryId, priority: t.priority, status: 'pending', dueDate: t.dueDate, dueTime: t.dueTime, notes: t.notes, links: structuredClone(t.links) });
}
export function addLog(id, text) { const t = getTask(id); if (t) { log(t, text); stamp(t); } }

export function upsert(coll, obj) {
  const arr = S()[coll]; const i = arr.findIndex(x => x.id === obj.id);
  stamp(obj); if (i >= 0) arr[i] = { ...arr[i], ...obj }; else arr.push(obj);
  return obj;
}
export function remove(coll, id) { const x = S()[coll].find(x => x.id === id); if (x) { x.deleted = true; stamp(x); } }
export function setSetting(k, v) { S().settings[k] = v; S().settingsUpdatedAt = Date.now(); }

export function ensureClient(name) {
  if (!name) return null;
  const n = name.trim(); let c = alive(S().clients).find(c => c.name.toLowerCase() === n.toLowerCase());
  if (!c) c = upsert('clients', { id: uid(), name: n, color: CLIENT_COLORS[alive(S().clients).length % CLIENT_COLORS.length], notes: '', archived: false });
  return c.id;
}
export function ensureCategory(name) {
  if (!name) return null;
  const n = name.trim(); let c = alive(S().categories).find(c => c.name.toLowerCase() === n.toLowerCase());
  if (!c) c = upsert('categories', { id: uid(), name: n });
  return c.id;
}

// ---------- Recurrentes ----------
// Se generan el último día de cada mes para el mes siguiente. Si la app no se abrió ese día,
// al abrirla en el mes nuevo se generan las fechas que aún no han pasado.
export function generateRecurring(month, { onlyTemplate = null, fromToday = false } = {}) {
  const [y, m] = month.split('-').map(Number);
  const last = lastDayOfMonth(y, m - 1);
  const today = todayStr();
  let count = 0;
  for (const r of alive(S().recurring)) {
    if (!r.active || (onlyTemplate && r.id !== onlyTemplate)) continue;
    const days = [...new Set((r.days || []).map(d => d === 'L' ? last : Math.min(Number(d), last)))].filter(Boolean);
    for (const d of days) {
      const due = `${month}-${String(d).padStart(2, '0')}`;
      if (fromToday && due < today) continue;
      const id = `rec-${r.id}-${due}`; // id determinista: evita duplicados entre dispositivos
      if (S().tasks.some(t => t.id === id)) continue;
      addTask({ id, title: r.title, clientId: r.clientId, categoryId: r.categoryId, priority: r.priority, status: 'pending', dueDate: due, dueTime: r.time || '', notes: r.notes || '', source: 'recurring', recurringId: r.id, logText: `Generada desde recurrentes (${month})` });
      count++;
    }
  }
  if (!onlyTemplate) { S().settings.recurringGenerated = { ...S().settings.recurringGenerated, [month]: true }; S().settingsUpdatedAt = Date.now(); }
  return count;
}
export function autoRecurring() {
  const d = new Date(); const cur = ym(d); const next = monthAdd(cur, 1);
  const gen = S().settings.recurringGenerated || {};
  let n = 0, months = [];
  if (!gen[cur]) { n += generateRecurring(cur, { fromToday: true }); months.push(cur); }
  if (d.getDate() === lastDayOfMonth(d.getFullYear(), d.getMonth()) && !gen[next]) { n += generateRecurring(next); months.push(next); }
  return { n, months };
}
export function nextRecurringRun() {
  const d = new Date(); const cur = ym(d); const next = monthAdd(cur, 1);
  const gen = S().settings.recurringGenerated || {};
  if (gen[next]) return { date: new Date(d.getFullYear(), d.getMonth() + 2, 0), month: monthAdd(cur, 2) };
  return { date: new Date(d.getFullYear(), d.getMonth() + 1, 0), month: next };
}

// ---------- Importar CSV de CM NOTES ----------
export function importSheetCSV(text, month) {
  const rows = parseCSV(text).map(r => r.map(c => c.trim()));
  const hi = rows.findIndex(r => r.some(c => /^task$/i.test(c)));
  if (hi < 0) throw new Error('No encontré la columna TASK en el CSV');
  const H = rows[hi].map(c => c.toUpperCase());
  const col = n => H.findIndex(h => h.startsWith(n));
  const ix = { task: col('TASK'), client: col('CLIENT'), cat: col('CATEGORY'), pri: col('PRIORITY'), st: col('STATUS'), due: col('DUE'), del: col('DEL'), notes: col('NOTES'), asg: col('ASSIGNED') };
  const toDate = v => { const d = parseInt(v, 10); return d ? `${month}-${String(d).padStart(2, '0')}` : ''; };
  const stMap = { finished: 'done', following: 'following', pending: 'pending', 'in progress': 'progress', progress: 'progress' };
  let n = 0;
  for (const r of rows.slice(hi + 1)) {
    const title = r[ix.task]; if (!title) continue;
    const status = stMap[(r[ix.st] || '').toLowerCase()] || 'pending';
    const due = ix.due >= 0 ? toDate(r[ix.due]) : '';
    const deliv = ix.del >= 0 ? r[ix.del] : '';
    const notes = [ix.notes >= 0 && r[ix.notes] && !/^https?:/.test(r[ix.notes]) ? r[ix.notes] : '', deliv && !/^https?:/.test(deliv) ? 'Entregable: ' + deliv : ''].filter(Boolean).join('\n');
    const links = [deliv, ix.notes >= 0 ? r[ix.notes] : ''].filter(u => /^https?:/.test(u || '')).map(url => ({ id: uid(), url, title: linkInfo(url).label, type: linkInfo(url).type }));
    const asg = ix.asg >= 0 ? toDate(r[ix.asg]) : '';
    const t = addTask({ title, clientId: ensureClient(r[ix.client]), categoryId: ensureCategory(r[ix.cat]), priority: /high|alta/i.test(r[ix.pri]) ? 'high' : 'normal', status, dueDate: due, notes, links, createdAt: asg ? new Date(parseYmd(asg).setHours(9)).toISOString() : undefined, logText: 'Importada desde CSV de CM NOTES' });
    if (status === 'done') t.completedAt = due ? new Date(parseYmd(due).setHours(17)).toISOString() : now();
    n++;
  }
  return n;
}

// Instantánea mínima para que el Service Worker avise de atrasadas en segundo plano
export function overdueSnapshot() {
  return tasks().filter(isOpen).filter(t => t.dueDate).map(t => ({ id: t.id, title: `${t.title} · ${clientName(t.clientId)}`, dueMs: dueMs(t) }));
}
