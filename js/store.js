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
    settings: { syncAheadDays: 0, notify: true, recurringGenerated: {}, gtListId: null, archives: {}, monthSeq: {}, codeV2: false }
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
    gtaskId: null, gtStatus: null, rank: null, carriedFrom: null, deleted: false, updatedAt: Date.now()
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
  out.settings.archives = { ...(a.settings.archives || {}), ...(b.settings?.archives || {}) };
  const seqA = a.settings.monthSeq || {}, seqB = b.settings?.monthSeq || {};
  out.settings.monthSeq = Object.fromEntries([...new Set([...Object.keys(seqA), ...Object.keys(seqB)])].map(k => [k, Math.max(seqA[k] || 0, seqB[k] || 0)]));
  out.settings.codeV2 = !!(a.settings.codeV2 || b.settings?.codeV2);
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
  t.code = nextCode(p.codeMonth || (p.source === 'recurring' && t.dueDate ? t.dueDate.slice(0, 7) : ym(new Date(t.createdAt))));
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


// ---------- Códigos por mes: T + MM + AA + consecutivo (T1026001) ----------
export const codePrefix = month => 'T' + month.slice(5, 7) + month.slice(2, 4);
export function codeMonth(code) {
  const m = /^T(\d{2})(\d{2})\d{3,}$/.exec(code || '');
  return m ? `20${m[2]}-${m[1]}` : null;
}
export function taskMonth(t) { return codeMonth(t.code) || (t.createdAt || '').slice(0, 7); }
function maxSeq(month) {
  const pre = codePrefix(month); let mx = S().settings.monthSeq?.[month] || 0;
  for (const t of S().tasks) if (t.code && t.code.startsWith(pre)) mx = Math.max(mx, parseInt(t.code.slice(5), 10) || 0);
  return mx;
}
export function nextCode(month) {
  const n = maxSeq(month) + 1;
  S().settings.monthSeq = { ...(S().settings.monthSeq || {}), [month]: n };
  return codePrefix(month) + String(n).padStart(3, '0');
}
// Convierte los códigos antiguos (T001) al formato por mes, una sola vez
export function migrateCodes() {
  if (S().settings.codeV2) return false;
  const list = S().tasks.filter(t => !t.deleted && !codeMonth(t.code)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const t of list) {
    const month = t.source === 'recurring' && t.dueDate ? t.dueDate.slice(0, 7) : ym(new Date(t.createdAt));
    t.code = nextCode(month); stamp(t);
  }
  S().settings.codeV2 = true; S().settingsUpdatedAt = Date.now();
  return list.length > 0;
}
export const monthCount = month => S().settings.monthSeq?.[month] || 0;

// ---------- Orden manual ----------
export function orderCmp(a, b) {
  const ra = a.rank ?? null, rb = b.rank ?? null;
  if (ra !== null && rb !== null) return ra - rb;
  if (ra !== null) return -1;
  if (rb !== null) return 1;
  return (dueMs(a) ?? 9e15) - (dueMs(b) ?? 9e15) || (a.priority === 'high' ? -1 : b.priority === 'high' ? 1 : 0) || a.createdAt.localeCompare(b.createdAt);
}
export function setOrder(ids) {
  ids.forEach((id, i) => { const t = getTask(id); if (t && t.rank !== (i + 1) * 1000) { t.rank = (i + 1) * 1000; stamp(t); } });
}

// ---------- Archivo mensual ----------
const AK = m => 'vkcrm.archive.' + m;
export function getArchive(month) { try { return JSON.parse(localStorage.getItem(AK(month)) || 'null'); } catch { return null; } }
export function saveArchive(a) { localStorage.setItem(AK(a.month), JSON.stringify(a)); }
export const archivedMonths = () => Object.keys(S().settings.archives || {}).sort().reverse();
export const isArchived = m => !!S().settings.archives?.[m];

// Meses que ya pueden archivarse: desde su último día y hasta que se archiven
export function archivableMonths(now = new Date()) {
  const cur = ym(now);
  const isLast = now.getDate() === lastDayOfMonth(now.getFullYear(), now.getMonth());
  const months = new Set();
  for (const t of tasks()) {
    if (t.status === 'done' && t.completedAt) months.add(ym(new Date(t.completedAt)));
    months.add(taskMonth(t));
  }
  return [...months].filter(m => m && !isArchived(m) && (m < cur || (m === cur && isLast))).sort();
}

export function archivePreview(month) {
  const done = tasks().filter(t => t.status === 'done' && t.completedAt && ym(new Date(t.completedAt)) === month);
  const pending = tasks().filter(t => t.status !== 'done' && taskMonth(t) <= month);
  return { done, pending };
}

function snapshotRefs(list) {
  const cl = {}, ca = {};
  for (const t of list) {
    if (t.clientId && !cl[t.clientId]) { const c = getClient(t.clientId); if (c) cl[t.clientId] = { name: c.name, color: c.color }; }
    if (t.categoryId && !ca[t.categoryId]) { const c = getCategory(t.categoryId); if (c) ca[t.categoryId] = c.name; }
  }
  return { clients: cl, categories: ca };
}

export function archiveMonth(month) {
  const { done, pending } = archivePreview(month);
  const next = monthAdd(month, 1);
  const tasksCopy = done.map(t => structuredClone(t));
  const archive = {
    month, archivedAt: now(), tasks: tasksCopy,
    pending: pending.map(t => ({ id: t.id, code: t.code, title: t.title, clientId: t.clientId, categoryId: t.categoryId, status: t.status, dueDate: t.dueDate, createdAt: t.createdAt })),
    ...snapshotRefs([...done, ...pending]), uploaded: false
  };
  saveArchive(archive);
  for (const t of done) { const i = S().tasks.indexOf(t); S().tasks[i] = { id: t.id, deleted: true, archived: month, updatedAt: Date.now() }; }
  for (const t of pending) {
    if (t.carriedFrom !== month) { t.carriedFrom = month; log(t, `Pasó a ${monthLabel(next)} (pendiente al cerrar ${monthLabel(month)})`); stamp(t); }
  }
  S().settings.archives = { ...(S().settings.archives || {}), [month]: { count: tasksCopy.length, pending: pending.length, archivedAt: archive.archivedAt } };
  S().settingsUpdatedAt = Date.now();
  return archive;
}

// Tareas terminadas en un mes ya archivado (por ejemplo, completadas después de archivar): se agregan a ese archivo
export function absorbStragglers() {
  let n = 0;
  for (const t of tasks()) {
    if (t.status !== 'done' || !t.completedAt) continue;
    const m = ym(new Date(t.completedAt));
    if (!isArchived(m)) continue;
    const a = getArchive(m); if (!a) continue;
    a.tasks = a.tasks.filter(x => x.id !== t.id).concat(structuredClone(t));
    const refs = snapshotRefs([t]);
    a.clients = { ...a.clients, ...refs.clients }; a.categories = { ...a.categories, ...refs.categories };
    a.uploaded = false; saveArchive(a);
    const i = S().tasks.indexOf(t); S().tasks[i] = { id: t.id, deleted: true, archived: m, updatedAt: Date.now() };
    S().settings.archives[m] = { ...S().settings.archives[m], count: a.tasks.length };
    n++;
  }
  if (n) S().settingsUpdatedAt = Date.now();
  return n;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const monthLabel = m => { const [y, mm] = m.split('-').map(Number); return `${MESES[mm - 1]} ${y}`; };

// ---------- Estadísticas ----------
export function allKnownTasks() {
  const map = new Map();
  for (const m of archivedMonths()) { const a = getArchive(m); if (a) for (const t of a.tasks) map.set(t.id, { ...t, _archived: m, _refs: a }); }
  for (const t of tasks()) map.set(t.id, t);
  return [...map.values()];
}
export const refClientName = t => getClient(t.clientId)?.name || t._refs?.clients?.[t.clientId]?.name || 'Sin cliente';
export const refClientColor = t => getClient(t.clientId)?.color || t._refs?.clients?.[t.clientId]?.color || '#5B6B8C';
export const refCategoryName = t => getCategory(t.categoryId)?.name || t._refs?.categories?.[t.categoryId] || 'Sin categoría';
export const deliveryMs = t => t.completedAt ? new Date(t.completedAt) - new Date(t.createdAt) : null;
export const wasLate = t => !!(t.completedAt && t.dueDate && new Date(t.completedAt).getTime() > dueMs(t));
