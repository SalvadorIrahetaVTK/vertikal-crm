// Sincronización: Drive (datos), Google Tasks (widget Android) y recurrentes
import { store, mergeStates, autoRecurring, tasks, getTask, updateTask, addTask, addLog, setSetting, isOpen, doneOn, clientName, categoryName, clients, ensureCategory } from './store.js';
import { auth, driveLoad, driveSave, ensureTaskList, listGTasks, insertGTask, patchGTask, deleteGTask } from './google.js';
import { todayStr, ymd, addDays } from './util.js';

const CFG = window.VK_CONFIG || {};
export const syncState = { status: 'local', lastSync: null, error: null, busy: false };
const listeners = new Set();
export const onSync = fn => listeners.add(fn);
const set = patch => { Object.assign(syncState, patch); listeners.forEach(f => f(syncState)); };

let again = false;
export async function syncAll({ reason = '' } = {}) {
  if (!auth.linked) { set({ status: 'local' }); return; }
  if (!auth.valid) { set({ status: 'auth' }); return; }
  if (syncState.busy) { again = true; return; }
  set({ busy: true, status: 'syncing', error: null });
  const before = JSON.stringify(store.state);
  try {
    store.dirty = false;
    const remote = await driveLoad();
    store.state = mergeStates(store.state, remote);
    const rec = autoRecurring();
    await syncGTasks();
    const now = JSON.stringify(store.state);
    if (!remote || now !== JSON.stringify(remote)) await driveSave(store.state);
    store.persist(false);
    set({ status: 'ok', lastSync: new Date().toISOString(), busy: false });
    if (now !== before) store.emit({ remote: true, recurring: rec });
  } catch (e) {
    console.error('Sync', reason, e);
    set({ status: e.auth ? 'auth' : 'error', error: e.message, busy: false });
  }
  if (again) { again = false; setTimeout(() => syncAll({ reason: 'queued' }), 300); }
}

const tag = (notes, k) => (notes || '').match(new RegExp('#' + k + ':([\\w-]+)'))?.[1] || null;
const gtTitle = t => `${t.title} · ${clientName(t.clientId)}`;
const gtNotes = t => [
  [clientName(t.clientId), categoryName(t.categoryId), t.dueTime ? 'Hora: ' + t.dueTime : ''].filter(Boolean).join(' · '),
  (t.notes || '').slice(0, 400),
  t.subtasks.length ? 'Subtareas: ' + t.subtasks.filter(s => s.done).length + '/' + t.subtasks.length : '',
  t.gmailThread ? '#gmail:' + t.gmailThread : '',
  '#crm:' + t.id
].filter(Boolean).join('\n');

function matchClient(text) {
  const s = (text || '').toLowerCase();
  return clients().find(c => c.name.length > 3 && s.includes(c.name.toLowerCase()))?.id || null;
}

export async function syncGTasks() {
  const st = store.state;
  const listId = await ensureTaskList(CFG.GTASKS_LIST_NAME || 'Vertikal CRM', st.settings.gtListId);
  if (listId !== st.settings.gtListId) setSetting('gtListId', listId);
  const remote = (await listGTasks(listId)).filter(r => !r.deleted);
  const byId = new Map(remote.map(r => [r.id, r]));

  // 1) Traer cambios del teléfono / Apps Script
  for (const r of remote) {
    const crmId = tag(r.notes, 'crm');
    if (crmId) {
      const t = st.tasks.find(x => x.id === crmId);
      if (!t || t.deleted) { await deleteGTask(listId, r.id); byId.delete(r.id); continue; }
      if (t.gtaskId !== r.id) {
        if (t.gtaskId && byId.has(t.gtaskId)) { await deleteGTask(listId, r.id); byId.delete(r.id); continue; }
        t.gtaskId = r.id; t.updatedAt = Date.now();
      }
      if (t.gtStatus && r.status !== t.gtStatus) {
        if (r.status === 'completed' && t.status !== 'done') { updateTask(t.id, { status: 'done', completedAt: r.completed || new Date().toISOString() }, true); addLog(t.id, 'Completada desde Google Tasks'); }
        else if (r.status === 'needsAction' && t.status === 'done') { updateTask(t.id, { status: t.startedAt ? 'progress' : 'pending' }, true); addLog(t.id, 'Reabierta desde Google Tasks'); }
        t.gtStatus = r.status; t.updatedAt = Date.now();
      }
      continue;
    }
    if (!r.title?.trim() || r.status === 'completed') continue;
    const gmail = tag(r.notes, 'gmail');
    let t;
    if (gmail) {
      // Correo nuevo (creado por el Apps Script): tarea "Revisar correo" para hoy
      const url = (r.notes.match(/https:\/\/mail\.google\.com\S+/) || [])[0] || `https://mail.google.com/mail/u/0/#all/${gmail}`;
      const from = (r.notes.match(/^De: (.+)$/m) || [])[1] || '';
      t = addTask({
        title: r.title, clientId: matchClient(r.title + ' ' + from), categoryId: ensureCategory('Comunicación'), priority: 'normal', status: 'pending',
        dueDate: todayStr(), notes: from ? 'De: ' + from : '', source: 'gmail', logText: 'Creada por correo nuevo en Gmail',
        links: [{ id: 'm' + gmail, url, title: 'Abrir correo en Gmail', type: 'mail' }]
      });
      t.gmailThread = gmail;
    } else {
      // Enviada desde Google Tasks: va al INBOX para completar detalles
      t = addTask({ title: r.title.trim(), status: 'inbox', notes: r.notes || '', dueDate: r.due ? r.due.slice(0, 10) : '', source: 'gtasks', logText: 'Recibida desde Google Tasks' });
    }
    t.gtaskId = r.id; t.gtStatus = r.status;
    const upd = await patchGTask(listId, r.id, { notes: ((r.notes || '') + '\n#crm:' + t.id).trim() });
    byId.set(r.id, upd);
  }

  // 2) Enviar al widget: pendientes de hoy (y atrasadas) + terminadas hoy
  const today = todayStr();
  const ahead = ymd(addDays(new Date(), st.settings.syncAheadDays || 0));
  const want = tasks().filter(t => t.status !== 'inbox' && ((isOpen(t) && t.dueDate && t.dueDate <= ahead) || doneOn(t, today)));
  const wantIds = new Set(want.map(t => t.id));
  for (const t of want) {
    const body = { title: gtTitle(t), notes: gtNotes(t), due: (t.dueDate || today) + 'T00:00:00.000Z', status: t.status === 'done' ? 'completed' : 'needsAction' };
    const r = t.gtaskId && byId.get(t.gtaskId);
    if (r) {
      const diff = r.title !== body.title || r.status !== body.status || (r.due || '').slice(0, 10) !== body.due.slice(0, 10) || (r.notes || '') !== body.notes;
      if (diff) {
        if (body.status === 'needsAction') body.completed = null;
        await patchGTask(listId, r.id, body);
      }
    } else {
      const n = await insertGTask(listId, body);
      t.gtaskId = n.id; byId.set(n.id, n);
    }
    if (t.gtStatus !== body.status || !r) { t.gtStatus = body.status; t.updatedAt = Date.now(); }
  }
  // 3) Limpiar lo que ya no corresponde al día
  for (const r of [...byId.values()]) {
    const crmId = tag(r.notes, 'crm');
    if (!crmId || wantIds.has(crmId)) continue;
    await deleteGTask(listId, r.id);
    const t = getTask(crmId);
    if (t && t.gtaskId === r.id) { t.gtaskId = null; t.gtStatus = null; t.updatedAt = Date.now(); }
  }
}

// Guardado remoto con espera (después de cambios locales)
let timer = null;
export function scheduleSync(ms = 2500) {
  clearTimeout(timer);
  timer = setTimeout(() => syncAll({ reason: 'change' }), ms);
}
