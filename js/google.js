// Autenticación (Google Identity Services) y llamadas a las APIs de Google
const CFG = window.VK_CONFIG || {};
const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
].join(' ');
const TK = 'vkcrm.auth';

let tokenClient = null;
let pending = null;
const authListeners = new Set();

export const auth = {
  get data() { try { return JSON.parse(localStorage.getItem(TK) || 'null'); } catch { return null; } },
  set data(v) { v ? localStorage.setItem(TK, JSON.stringify(v)) : localStorage.removeItem(TK); authListeners.forEach(f => f(v)); },
  get configured() { return !!CFG.GOOGLE_CLIENT_ID; },
  get linked() { return !!this.data?.email; },
  get valid() { const d = this.data; return !!(d && d.token && d.exp > Date.now() + 60e3); },
  onChange(fn) { authListeners.add(fn); }
};

function waitGis() {
  return new Promise((res, rej) => {
    let n = 0; const t = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(t); res(); }
      else if (++n > 100) { clearInterval(t); rej(new Error('No cargó Google Identity Services')); }
    }, 100);
  });
}

async function client() {
  if (tokenClient) return tokenClient;
  await waitGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CFG.GOOGLE_CLIENT_ID, scope: SCOPES,
    callback: async r => {
      if (r.error) { pending?.rej(new Error(r.error)); pending = null; return; }
      const prev = auth.data || {};
      const d = { ...prev, token: r.access_token, exp: Date.now() + (r.expires_in - 30) * 1000 };
      auth.data = d;
      try {
        const me = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + d.token } }).then(x => x.json());
        auth.data = { ...auth.data, email: me.email, name: me.name, picture: me.picture };
      } catch {}
      pending?.res(auth.data.token); pending = null;
    },
    error_callback: e => { pending?.rej(new Error(e.type || 'popup')); pending = null; }
  });
  return tokenClient;
}

// Debe llamarse desde un clic del usuario (abre la ventana de Google)
export async function signIn(silent = false) {
  if (!auth.configured) throw new Error('Falta GOOGLE_CLIENT_ID en js/config.js');
  const c = await client();
  return new Promise((res, rej) => {
    pending = { res, rej };
    c.requestAccessToken({ prompt: silent ? '' : (auth.linked ? '' : 'consent'), login_hint: auth.data?.email || undefined });
  });
}
export function signOut() {
  const d = auth.data;
  if (d?.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(d.token, () => {});
  auth.data = null;
}

export class AuthError extends Error { constructor() { super('Sesión de Google expirada'); this.auth = true; } }

export async function api(url, opts = {}) {
  if (!auth.valid) throw new AuthError();
  const headers = { Authorization: 'Bearer ' + auth.data.token, ...(opts.headers || {}) };
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) { auth.data = { ...auth.data, token: null, exp: 0 }; throw new AuthError(); }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    let msg = text; try { msg = JSON.parse(text).error.message; } catch {}
    throw new Error(`Google API ${res.status}: ${msg}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

// ---------- Drive: datos de la app (appDataFolder) ----------
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DATA_FILE = 'vertikal-crm-data.json';
let dataFileId = null;

export async function driveLoad() {
  if (!dataFileId) {
    const r = await api(`${DRIVE}/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${DATA_FILE}'`)}&fields=files(id,modifiedTime)`);
    dataFileId = r.files?.[0]?.id || null;
  }
  if (!dataFileId) return null;
  return api(`${DRIVE}/files/${dataFileId}?alt=media`);
}

function multipartBody(meta, content, mime) {
  const b = 'vk' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`,
    content, `\r\n--${b}--`
  ]);
  return { body, type: `multipart/related; boundary=${b}` };
}

export async function driveSave(state) {
  const json = JSON.stringify(state);
  if (dataFileId) {
    return api(`${UPLOAD}/files/${dataFileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json });
  }
  const { body, type } = multipartBody({ name: DATA_FILE, parents: ['appDataFolder'] }, json, 'application/json');
  const r = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': type }, body });
  dataFileId = r.id; return r;
}

// ---------- Drive: adjuntos ----------
async function findOrCreateFolder(name, parent) {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false` + (parent ? ` and '${parent}' in parents` : '');
  const r = await api(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`);
  if (r.files?.length) return r.files[0].id;
  const c = await api(`${DRIVE}/files?fields=id`, { method: 'POST', json: { name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) } });
  return c.id;
}

export async function uploadFile(file, clientName, onProgress) {
  const root = await findOrCreateFolder(CFG.DRIVE_UPLOAD_FOLDER || 'Vertikal CRM · Adjuntos');
  const folder = await findOrCreateFolder(clientName || 'General', root);
  const meta = { name: file.name, parents: [folder] };
  const fields = 'id,name,mimeType,webViewLink,size,iconLink';
  if (file.size <= 5 * 1024 * 1024) {
    const { body, type } = multipartBody(meta, file, file.type || 'application/octet-stream');
    return api(`${UPLOAD}/files?uploadType=multipart&fields=${fields}`, { method: 'POST', headers: { 'Content-Type': type }, body });
  }
  // Archivos grandes: subida reanudable
  if (!auth.valid) throw new AuthError();
  const init = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=${fields}`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + auth.data.token, 'Content-Type': 'application/json', 'X-Upload-Content-Type': file.type || 'application/octet-stream' }, body: JSON.stringify(meta)
  });
  const loc = init.headers.get('Location');
  if (!init.ok || !loc) throw new Error('No se pudo iniciar la subida del archivo grande');
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('PUT', loc);
    x.upload.onprogress = e => onProgress?.(e.loaded / e.total);
    x.onload = () => x.status < 300 ? res(JSON.parse(x.responseText)) : rej(new Error('Error al subir: ' + x.status));
    x.onerror = () => rej(new Error('Error de red al subir'));
    x.send(file);
  });
}

export const driveMeta = id => api(`${DRIVE}/files/${id}?fields=id,name,mimeType,webViewLink&supportsAllDrives=true`);

// ---------- Google Tasks ----------
const TASKS = 'https://tasks.googleapis.com/tasks/v1';
export async function ensureTaskList(name, knownId) {
  if (knownId) { try { await api(`${TASKS}/users/@me/lists/${knownId}`); return knownId; } catch (e) { if (e.auth) throw e; } }
  const r = await api(`${TASKS}/users/@me/lists?maxResults=100`);
  const f = (r.items || []).find(l => l.title === name);
  if (f) return f.id;
  return (await api(`${TASKS}/users/@me/lists`, { method: 'POST', json: { title: name } })).id;
}
export async function listGTasks(listId) {
  let items = [], token = '';
  do {
    const r = await api(`${TASKS}/lists/${listId}/tasks?showCompleted=true&showHidden=true&maxResults=100${token ? '&pageToken=' + token : ''}`);
    items = items.concat(r.items || []); token = r.nextPageToken || '';
  } while (token);
  return items;
}
export const insertGTask = (listId, body) => api(`${TASKS}/lists/${listId}/tasks`, { method: 'POST', json: body });
export const patchGTask = (listId, id, body) => api(`${TASKS}/lists/${listId}/tasks/${id}`, { method: 'PATCH', json: body });
export const deleteGTask = (listId, id) => api(`${TASKS}/lists/${listId}/tasks/${id}`, { method: 'DELETE' }).catch(e => { if (!/404/.test(e.message)) throw e; });

// ---------- Google Calendar ----------
const CAL = 'https://www.googleapis.com/calendar/v3';
export function listEvents(days = 14) {
  const min = new Date(); min.setHours(0, 0, 0, 0);
  const max = new Date(min.getTime() + days * 864e5);
  return api(`${CAL}/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${min.toISOString()}&timeMax=${max.toISOString()}`).then(r => r.items || []);
}
export function createEvent({ title, description, start, end, attendees = [], meet = true, tz }) {
  const body = {
    summary: title, description,
    start: { dateTime: start, timeZone: tz }, end: { dateTime: end, timeZone: tz },
    attendees: attendees.map(email => ({ email })),
    reminders: { useDefault: true }
  };
  if (meet) body.conferenceData = { createRequest: { requestId: 'vk' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  return api(`${CAL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${attendees.length ? 'all' : 'none'}`, { method: 'POST', json: body });
}
