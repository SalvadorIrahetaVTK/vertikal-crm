// Utilidades compartidas
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const icon = (name, cls = '') => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;

export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const todayStr = () => ymd(new Date());
export const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const lastDayOfMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();
export const monthAdd = (ymStr, n) => { const [y, m] = ymStr.split('-').map(Number); return ym(new Date(y, m - 1 + n, 1)); };

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIA_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const monthName = (ymStr, long = true) => { const [y, m] = ymStr.split('-').map(Number); return `${(long ? MES_L : MES)[m - 1]} ${y}`; };
export const fmtDate = (s, withDow = true) => {
  if (!s) return '';
  const d = parseYmd(s); const t = todayStr();
  if (s === t) return 'Hoy';
  if (s === ymd(addDays(new Date(), 1))) return 'Mañana';
  if (s === ymd(addDays(new Date(), -1))) return 'Ayer';
  return `${withDow ? DIA[d.getDay()] + ' ' : ''}${d.getDate()} ${MES[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
};
export const fmtLongDate = d => `${DIA_L[d.getDay()]} ${d.getDate()} de ${MES_L[d.getMonth()]} de ${d.getFullYear()}`;
export const fmtDateTime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${MES[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''} · ${fmtTime(d)}`;
};
export const fmtTime = d => {
  let h = d.getHours(); const m = pad(d.getMinutes()); const ap = h >= 12 ? 'p. m.' : 'a. m.';
  h = h % 12 || 12; return `${h}:${m} ${ap}`;
};
export const fmtHM = hm => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); const d = new Date(); d.setHours(h, m); return fmtTime(d); };
export const relTime = iso => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return fmtDateTime(iso);
};

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Detecta el tipo de enlace de Google / PDF
export function linkInfo(url) {
  const u = String(url || '').trim();
  let type = 'link', label = 'Enlace';
  if (/docs\.google\.com\/document/.test(u)) { type = 'doc'; label = 'Google Docs'; }
  else if (/docs\.google\.com\/spreadsheets/.test(u)) { type = 'sheet'; label = 'Google Sheets'; }
  else if (/docs\.google\.com\/presentation/.test(u)) { type = 'slides'; label = 'Google Slides'; }
  else if (/drive\.google\.com\/(drive\/(u\/\d+\/)?folders|.*folderview)/.test(u)) { type = 'folder'; label = 'Carpeta de Drive'; }
  else if (/\.pdf(\?|#|$)/i.test(u)) { type = 'pdf'; label = 'PDF'; }
  else if (/drive\.google\.com\/(file|open|uc)/.test(u)) { type = 'file'; label = 'Archivo de Drive'; }
  else if (/mail\.google\.com/.test(u)) { type = 'mail'; label = 'Correo'; }
  else if (/calendar\.google\.com/.test(u)) { type = 'calendar'; label = 'Evento'; }
  const m = u.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || u.match(/folders\/([a-zA-Z0-9_-]{10,})/) || u.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return { type, label, driveId: m ? m[1] : null };
}
export const typeIcon = t => ({ doc: 'doc', sheet: 'sheet', slides: 'slides', folder: 'folder', pdf: 'pdf', file: 'file', mail: 'mail', calendar: 'calendar' }[t] || 'link');
export const mimeToType = mime => {
  if (!mime) return 'file';
  if (mime.includes('document')) return 'doc';
  if (mime.includes('spreadsheet')) return 'sheet';
  if (mime.includes('presentation')) return 'slides';
  if (mime.includes('folder')) return 'folder';
  if (mime.includes('pdf')) return 'pdf';
  return 'file';
};
export const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

// CSV parser simple (soporta comillas)
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
