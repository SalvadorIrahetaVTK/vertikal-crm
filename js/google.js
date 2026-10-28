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

// ---------- Drive: archivos mensuales (appDataFolder) ----------
const archiveName = m => `vertikal-crm-archive-${m}.json`;
export async function archiveSave(a) {
  const json = JSON.stringify({ ...a, uploaded: true });
  const q = encodeURIComponent(`name='${archiveName(a.month)}'`);
  const r = await api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  const id = r.files?.[0]?.id;
  if (id) return api(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json });
  const { body, type } = multipartBody({ name: archiveName(a.month), parents: ['appDataFolder'] }, json, 'application/json');
  return api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': type }, body });
}
export async function archiveLoad(month) {
  const q = encodeURIComponent(`name='${archiveName(month)}'`);
  const r = await api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  const id = r.files?.[0]?.id;
  return id ? api(`${DRIVE}/files/${id}?alt=media`) : null;
}

// ---------- Calendar por rango ----------
export function listEventsRange(min, max) {
  return api(`${CAL}/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${min.toISOString()}&timeMax=${max.toISOString()}`).then(r => r.items || []);
}

// ---------- Google Sheets: exportación en formato CM NOTES ----------
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
export async function exportToSheet({ title, sheetTitle, header, rows, validations = {}, folderName }) {
  const ss = await api(SHEETS, { method: 'POST', json: {
    properties: { title, locale: 'en_US', timeZone: CFG.TIMEZONE || 'America/Guatemala' },
    sheets: [{ properties: { title: sheetTitle, gridProperties: { frozenRowCount: 1, columnCount: header.length + 1, rowCount: Math.max(rows.length + 20, 60) } } }]
  } });
  const sid = ss.sheets[0].properties.sheetId;
  const range = encodeURIComponent(`'${sheetTitle}'!B1`);
  await api(`${SHEETS}/${ss.spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, { method: 'PUT', json: { values: [header, ...rows] } });
  const n = rows.length + 1, cols = header.length;
  const col = name => header.indexOf(name) + 1;
  const reqs = [
    { repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: n, startColumnIndex: 1, endColumnIndex: cols + 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Inter', fontSize: 10, foregroundColor: { red: 0.07, green: 0.08, blue: 0.2 } }, verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment)' } },
    { repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: cols + 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.643, green: 0.761, blue: 0.957 }, horizontalAlignment: 'CENTER', textFormat: { bold: true, fontFamily: 'Inter', fontSize: 10, foregroundColor: { red: 0.0, green: 0.12, blue: 0.55 } } } }, fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)' } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 0, endIndex: n }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    { setBasicFilter: { filter: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: n, startColumnIndex: 1, endColumnIndex: cols + 1 } } } }
  ];
  const widths = { COD: 80, TASK: 320, CLIENT: 150, CATEGORY: 120, PRIORITY: 80, STATUS: 95, 'DUE DATE': 90, DELIVERY: 260, NOTES: 260, ASSIGNED: 90, 'FINISHED AT': 140 };
  header.forEach((h, i) => widths[h] && reqs.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: i + 1, endIndex: i + 2 }, properties: { pixelSize: widths[h] }, fields: 'pixelSize' } }));
  for (const [name, values] of Object.entries(validations)) {
    const c = col(name); if (!c || !values.length) continue;
    reqs.push({ setDataValidation: { range: { sheetId: sid, startRowIndex: 1, endRowIndex: n, startColumnIndex: c, endColumnIndex: c + 1 }, rule: { condition: { type: 'ONE_OF_LIST', values: values.map(v => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } });
  }
  for (const name of ['DUE DATE', 'ASSIGNED']) { const c = col(name); if (c) reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 1, endRowIndex: n, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd  ddd' }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } }); }
  const fc = col('FINISHED AT'); if (fc) reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 1, endRowIndex: n, startColumnIndex: fc, endColumnIndex: fc + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'dd mmm yyyy h:mm am/pm' } } }, fields: 'userEnteredFormat.numberFormat' } });
  const sc = col('STATUS');
  if (sc) {
    const colors = { Finished: [0.85, 0.96, 0.89, 0.0, 0.45, 0.2], Following: [0.86, 0.9, 1, 0.0, 0.3, 0.8], Pending: [0.93, 0.94, 0.96, 0.3, 0.35, 0.45], 'In progress': [0.86, 0.9, 1, 0.0, 0.2, 0.7] };
    Object.entries(colors).forEach(([v, c]) => reqs.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: n, startColumnIndex: sc, endColumnIndex: sc + 1 }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: v }] }, format: { backgroundColor: { red: c[0], green: c[1], blue: c[2] }, textFormat: { bold: true, foregroundColor: { red: c[3], green: c[4], blue: c[5] } } } } } } }));
  }
  await api(`${SHEETS}/${ss.spreadsheetId}:batchUpdate`, { method: 'POST', json: { requests: reqs } });
  if (folderName) {
    try {
      const folder = await findOrCreateFolder(folderName);
      await api(`${DRIVE}/files/${ss.spreadsheetId}?addParents=${folder}&removeParents=root&fields=id`, { method: 'PATCH', json: {} });
    } catch (e) { console.warn('No se pudo mover a la carpeta', e); }
  }
  return ss.spreadsheetUrl;
}
