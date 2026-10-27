/**
 * Vertikal CRM · Gmail → Google Tasks
 * Cada 5 minutos revisa tu bandeja y crea la tarea "Revisar correo: <asunto>"
 * en la lista "Vertikal CRM" de Google Tasks. El CRM la importa sola (con enlace al correo)
 * y aparece en tu widget de Android.
 *
 * Instalación (una sola vez):
 *  1. script.google.com › Nuevo proyecto › pega este archivo.
 *  2. Servicios (+) › agrega "Google Tasks API" (identificador: Tasks).
 *  3. Ejecuta la función setup() y acepta los permisos.
 */
const CONFIG = {
  LIST_NAME: 'Vertikal CRM',                       // igual que GTASKS_LIST_NAME en js/config.js
  QUERY: 'in:inbox is:unread category:primary',    // qué correos generan tarea (sintaxis de búsqueda de Gmail)
  AUTO_COMPLETE_WHEN_READ: true,                   // marcar la tarea como hecha cuando leas o archives el correo
  MAX_PER_RUN: 25,
  PREFIX: 'Revisar correo: '
};

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'checkMail') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkMail').timeBased().everyMinutes(5).create();
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SINCE')) p.setProperty('SINCE', String(Date.now() - 15 * 60 * 1000));
  checkMail();
  Logger.log('Listo: revisando Gmail cada 5 minutos.');
}

function checkMail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const since = Number(props.getProperty('SINCE') || Date.now() - 3600e3);
    const seen = JSON.parse(props.getProperty('SEEN') || '{}');
    const listId = getListId_();
    const runStart = Date.now();

    // 1) Correos nuevos → tareas
    const after = Math.floor(since / 1000) - 120;
    const threads = GmailApp.search(CONFIG.QUERY + ' after:' + after, 0, CONFIG.MAX_PER_RUN);
    threads.forEach(th => {
      const msgs = th.getMessages();
      const last = msgs[msgs.length - 1];
      if (last.getDate().getTime() < since - 120000) return;
      const id = th.getId();
      const prev = seen[id];
      if (prev && prev.msg === last.getId()) return;       // ya procesado
      if (prev && prev.open && isOpen_(listId, prev.task)) { // ya hay una tarea abierta para este hilo
        prev.msg = last.getId(); return;
      }
      const from = last.getFrom().replace(/"/g, '');
      const task = Tasks.Tasks.insert({
        title: CONFIG.PREFIX + (th.getFirstMessageSubject() || '(sin asunto)'),
        notes: 'De: ' + from + '\n#gmail:' + id + '\nhttps://mail.google.com/mail/u/0/#inbox/' + id,
        due: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + 'T00:00:00.000Z'
      }, listId);
      seen[id] = { task: task.id, msg: last.getId(), open: true, at: Date.now() };
    });

    // 2) Correo leído o archivado → tarea completada
    if (CONFIG.AUTO_COMPLETE_WHEN_READ) {
      Object.keys(seen).forEach(id => {
        const s = seen[id];
        if (!s.open) return;
        try {
          const th = GmailApp.getThreadById(id);
          const stillPending = th && th.isUnread() && th.isInInbox();
          if (!stillPending) {
            try { Tasks.Tasks.patch({ status: 'completed' }, listId, s.task); } catch (e) { /* el CRM ya la movió o borró */ }
            s.open = false;
          }
        } catch (e) { s.open = false; }
      });
    }

    // 3) Limpieza (7 días)
    Object.keys(seen).forEach(id => { if (Date.now() - seen[id].at > 7 * 864e5) delete seen[id]; });
    props.setProperty('SEEN', JSON.stringify(seen));
    props.setProperty('SINCE', String(runStart));
  } finally {
    lock.releaseLock();
  }
}

function isOpen_(listId, taskId) {
  try { return Tasks.Tasks.get(listId, taskId).status === 'needsAction'; } catch (e) { return false; }
}

function getListId_() {
  const cache = PropertiesService.getScriptProperties();
  const known = cache.getProperty('LIST_ID');
  if (known) { try { Tasks.Tasklists.get(known); return known; } catch (e) {} }
  const lists = (Tasks.Tasklists.list({ maxResults: 100 }).items || []);
  const found = lists.find(l => l.title === CONFIG.LIST_NAME);
  const id = found ? found.id : Tasks.Tasklists.insert({ title: CONFIG.LIST_NAME }).id;
  cache.setProperty('LIST_ID', id);
  return id;
}
