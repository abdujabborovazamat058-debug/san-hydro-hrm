'use strict';
/* SAN HYDRO ENERGY HRM server. Tashqi paketlar kerak emas: faqat Node 22.5+ */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TZ = Number(process.env.TZ_OFFSET_HOURS || 5); // Toshkent UTC+5
const PUBLIC = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'hrm.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL, emp_id INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS employees(id INTEGER PRIMARY KEY, no TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, dept TEXT NOT NULL, shift_start TEXT NOT NULL, shift_end TEXT NOT NULL, salary REAL NOT NULL, hired TEXT NOT NULL, photo TEXT, descriptor TEXT);
CREATE TABLE IF NOT EXISTS candidates(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, role TEXT, salary REAL, address TEXT, lat REAL, lng REAL, photo TEXT, descriptor TEXT, stage TEXT NOT NULL DEFAULT 'new', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS att(emp_id INTEGER NOT NULL, date TEXT NOT NULL, in_t TEXT, out_t TEXT, in_dist INTEGER, out_dist INTEGER, in_photo TEXT, out_photo TEXT, in_face REAL, out_face REAL, PRIMARY KEY(emp_id,date));
CREATE TABLE IF NOT EXISTS kpi(emp_id INTEGER NOT NULL, month TEXT NOT NULL, plan REAL NOT NULL, PRIMARY KEY(emp_id,month));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

/* ---------- yordamchilar ---------- */
const DEFAULTS = {
  place: { addr: '', lat: null, lng: null, r: 150 },
  rules: { grace: 5, otMin: 30, otk: 1.5, kpiMax: 15, jshds: 12, inps: 0.1 },
  face: { threshold: 0.5 },
};
function getSetting(k) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
  return Object.assign({}, DEFAULTS[k], r ? JSON.parse(r.value) : {});
}
function setSetting(k, v) { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v)); }
function nowTk() { const d = new Date(Date.now() + TZ * 3600e3); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
const toMin = (h) => { const p = String(h).split(':').map(Number); return p[0] * 60 + p[1]; };
const pad = (n) => String(n).padStart(2, '0');
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function makeAccount(username, password, role, empId) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO accounts(username,salt,hash,role,emp_id) VALUES(?,?,?,?,?)').run(username, salt, hashPw(password, salt), role, empId || null);
}
function setPassword(accId, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE accounts SET salt=?,hash=? WHERE id=?').run(salt, hashPw(password, salt), accId);
}
function checkPw(acc, pw) {
  const a = Buffer.from(hashPw(pw, acc.salt), 'hex'), b = Buffer.from(acc.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, x = Math.PI / 180, dl = (lat2 - lat1) * x, dg = (lng2 - lng1) * x;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(lat1 * x) * Math.cos(lat2 * x) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function faceDist(a, b) { let s = 0; for (let i = 0; i < 128; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); }
const validDesc = (d) => Array.isArray(d) && d.length === 128 && d.every((n) => typeof n === 'number' && isFinite(n));
const validPhoto = (p) => p == null || p === '' || (typeof p === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p) && p.length < 60000);
const num = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

/* haqiqiy mijoz IP (Render kabi proxy orqasida) */
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  return xf.length ? xf[xf.length - 1] : (req.socket.remoteAddress || '');
}
/* kirish urinishlarini cheklash */
const tries = new Map();
function limited(key, max, windowMs) {
  const t = Date.now(); const a = (tries.get(key) || []).filter((x) => t - x < windowMs);
  tries.set(key, a); return a.length >= max;
}
function hit(key) { const a = tries.get(key) || []; a.push(Date.now()); tries.set(key, a); }

/* ---------- hisob-kitob ---------- */
function monthDays(mk) { const [y, m] = mk.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); const a = []; for (let i = 1; i <= n; i++) a.push(`${mk}-${pad(i)}`); return a; }
const isWork = (ds) => { const g = new Date(ds + 'T00:00:00Z').getUTCDay(); return g !== 0 && g !== 6; };
function statsFor(e, mk, rules, today) {
  const days = monthDays(mk).filter(isWork);
  const rows = db.prepare('SELECT date,in_t,out_t FROM att WHERE emp_id=? AND date LIKE ?').all(e.id, mk + '-%');
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
  const st = toMin(e.shift_start), en = toMin(e.shift_end);
  let plan = 0, att = 0, lateDays = 0, lateMin = 0, otMin = 0, workMin = 0;
  for (const ds of days) {
    if (ds < e.hired || ds > today.date) continue;
    const r = byDate[ds];
    if (ds === today.date && !(r && r.in_t)) continue;
    plan++;
    if (!r || !r.in_t) continue;
    att++;
    const l = toMin(r.in_t) - st;
    if (l > rules.grace) { lateDays++; lateMin += l; }
    if (r.out_t) { const o = toMin(r.out_t) - en; if (o >= rules.otMin) otMin += o; workMin += Math.max(0, toMin(r.out_t) - toMin(r.in_t)); }
  }
  return { planFull: days.length, plan, att, abs: plan - att, lateDays, lateMin, otMin, workMin };
}
function kpiFor(e, c, mk) {
  const k = db.prepare('SELECT plan FROM kpi WHERE emp_id=? AND month=?').get(e.id, mk);
  const plan = k ? k.plan : 80;
  const attPct = c.plan ? (c.att / c.plan) * 100 : 0, punct = c.att ? ((c.att - c.lateDays) / c.att) * 100 : 0;
  const total = 0.5 * plan + 0.3 * attPct + 0.2 * punct;
  return { plan, attPct, punct, total, grade: total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : 'D' };
}
function reportFor(mk) {
  const rules = getSetting('rules'), today = nowTk();
  return db.prepare('SELECT * FROM employees ORDER BY no').all().map((e) => {
    const c = statsFor(e, mk, rules, today);
    const perDay = e.salary / c.planFull, hourly = perDay / 8;
    const earned = perDay * c.att, lateDed = (c.lateMin / 60) * hourly, ot = (c.otMin / 60) * hourly * rules.otk;
    const k = kpiFor(e, c, mk), bonus = earned * (rules.kpiMax / 100) * (k.total / 100);
    const gross = earned - lateDed + ot + bonus, tax = (gross * (rules.jshds + rules.inps)) / 100;
    return { id: e.id, no: e.no, name: e.name, role: e.role, dept: e.dept, shift: `${e.shift_start}-${e.shift_end}`, salary: e.salary, ...c, earned, lateDed, ot, bonus, gross, tax, net: gross - tax, kpi: k };
  });
}
const CSVH = {
  uz: ['Tabel №', 'F.I.Sh.', 'Lavozim', "Bo'lim", 'Oylik maosh', 'Ish vaqti', 'Reja kunlari', 'Kelgan kunlar', 'Kelmagan kunlar', 'Kechikkan kunlar', 'Kechikish (daq)', 'Ishlagan soat', "Qo'shimcha soat", 'Hisoblangan (brutto)', "Qo'lga tegadi"],
  ru: ['Табельный №', 'Ф.И.О.', 'Должность', 'Отдел', 'Оклад', 'Время работы', 'Плановые дни', 'Дни присутствия', 'Пропущено дней', 'Дни опозданий', 'Опоздания (мин)', 'Отработано часов', 'Сверхурочные часы', 'Начислено (брутто)', 'На руки'],
};
const csvCell = (v) => { const s = String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/* ---------- HTTP ---------- */
function send(res, code, body, headers) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(code, Object.assign({ 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(isStr ? body : JSON.stringify(body));
}
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1.5e6) { reject(new HttpError(413, 'too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'bad_json')); } });
    req.on('error', reject);
  });
}
function parseCookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function session(req) {
  const tok = parseCookies(req).sid; if (!tok) return null;
  const s = db.prepare('SELECT s.account_id,s.expires,a.username,a.role,a.emp_id FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token=?').get(tok);
  if (!s || s.expires < Date.now()) return null;
  return { accId: s.account_id, username: s.username, role: s.role, empId: s.emp_id };
}
const isHr = (u) => u && (u.role === 'admin' || u.role === 'hr');
function publicEmp(e) { return { id: e.id, no: e.no, name: e.name, role: e.role, dept: e.dept, start: e.shift_start, end: e.shift_end, salary: e.salary, hired: e.hired, photo: e.photo || '', hasFace: !!e.descriptor }; }
function publicCand(c) { return { id: c.id, name: c.name, phone: c.phone, role: c.role, salary: c.salary, address: c.address, lat: c.lat, lng: c.lng, photo: c.photo || '', hasFace: !!c.descriptor, stage: c.stage, created: c.created }; }

const routes = [];
const route = (method, pattern, auth, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:id/g, '(\\d+)') + '$'), auth, fn });

/* --- kirish --- */
route('POST', '/api/login', 'none', (ctx) => {
  const ip = clientIp(ctx.req);
  const username = str(ctx.body.username, 60), password = String(ctx.body.password || '');
  if (limited('login:' + ip, 10, 15 * 60e3) || limited('loginu:' + username.toLowerCase(), 10, 15 * 60e3)) throw new HttpError(429, 'too_many');
  const acc = db.prepare('SELECT * FROM accounts WHERE lower(username)=lower(?)').get(username);
  if (!acc || !checkPw(acc, password)) { hit('login:' + ip); hit('loginu:' + username.toLowerCase()); throw new HttpError(401, 'bad_credentials'); }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  db.prepare('INSERT INTO sessions(token,account_id,expires) VALUES(?,?,?)').run(token, acc.id, Date.now() + 12 * 3600e3);
  const secure = ctx.req.socket.encrypted || ctx.req.headers['x-forwarded-proto'] === 'https';
  const emp = acc.emp_id ? db.prepare('SELECT name FROM employees WHERE id=?').get(acc.emp_id) : null;
  return [200, { role: acc.role, empId: acc.emp_id, name: emp ? emp.name : acc.username }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}${secure ? '; Secure' : ''}` }];
});
route('POST', '/api/logout', 'none', (ctx) => {
  const tok = parseCookies(ctx.req).sid; if (tok) db.prepare('DELETE FROM sessions WHERE token=?').run(tok);
  return [200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }];
});
route('GET', '/api/me', 'user', (ctx) => {
  const u = ctx.user; const emp = u.empId ? db.prepare('SELECT * FROM employees WHERE id=?').get(u.empId) : null;
  return [200, { role: u.role, empId: u.empId, name: emp ? emp.name : u.username, emp: emp ? publicEmp(emp) : null, today: nowTk(), place: getSetting('place'), rules: getSetting('rules'), face: getSetting('face') }];
});
route('POST', '/api/password', 'user', (ctx) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(ctx.user.accId);
  const np = String(ctx.body.newPassword || '');
  if (!checkPw(acc, String(ctx.body.oldPassword || ''))) throw new HttpError(403, 'bad_old_password');
  if (np.length < 6) throw new HttpError(400, 'short_password');
  setPassword(acc.id, np); return [200, { ok: true }];
});

/* --- sozlamalar --- */
route('PUT', '/api/settings', 'hr', (ctx) => {
  const b = ctx.body;
  if (b.place) {
    const lat = num(b.place.lat), lng = num(b.place.lng), r = num(b.place.r) || 150;
    if ((lat != null && Math.abs(lat) > 90) || (lng != null && Math.abs(lng) > 180)) throw new HttpError(400, 'bad_coords');
    setSetting('place', { addr: str(b.place.addr, 300), lat, lng, r: Math.max(10, r) });
  }
  if (b.rules) { const o = {}; for (const k of Object.keys(DEFAULTS.rules)) { const v = num(b.rules[k]); if (v == null || v < 0) throw new HttpError(400, 'bad_rules'); o[k] = v; } setSetting('rules', o); }
  if (b.face) { const t = num(b.face.threshold); if (t == null || t < 0.3 || t > 0.7) throw new HttpError(400, 'bad_threshold'); setSetting('face', { threshold: t }); }
  return [200, { place: getSetting('place'), rules: getSetting('rules'), face: getSetting('face') }];
});

/* --- xodimlar --- */
function readEmp(b, partial) {
  const e = { name: str(b.name, 120), role: str(b.role, 100), dept: str(b.dept, 100), shift_start: str(b.start, 5), shift_end: str(b.end, 5), salary: num(b.salary), hired: str(b.hired, 10) };
  if (!e.name || !e.role || !e.dept) throw new HttpError(400, 'need_name_role_dept');
  if (!(e.salary > 0)) throw new HttpError(400, 'bad_salary');
  if (!/^\d{2}:\d{2}$/.test(e.shift_start) || !/^\d{2}:\d{2}$/.test(e.shift_end) || toMin(e.shift_end) <= toMin(e.shift_start)) throw new HttpError(400, 'bad_shift');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.hired)) throw new HttpError(400, 'bad_date');
  return e;
}
function nextNo() { const r = db.prepare("SELECT no FROM employees WHERE no LIKE 'SHE-%' ORDER BY CAST(substr(no,5) AS INTEGER) DESC LIMIT 1").get(); const n = r ? parseInt(r.no.slice(4), 10) + 1 : 1; return 'SHE-' + String(n).padStart(3, '0'); }
function createEmployee(e, photo, desc, password) {
  const no = nextNo();
  const r = db.prepare('INSERT INTO employees(no,name,role,dept,shift_start,shift_end,salary,hired,photo,descriptor) VALUES(?,?,?,?,?,?,?,?,?,?)').run(no, e.name, e.role, e.dept, e.shift_start, e.shift_end, e.salary, e.hired, photo || null, desc ? JSON.stringify(desc) : null);
  makeAccount(no, password, 'employee', Number(r.lastInsertRowid));
  return db.prepare('SELECT * FROM employees WHERE id=?').get(r.lastInsertRowid);
}
route('GET', '/api/employees', 'hr', () => [200, db.prepare('SELECT * FROM employees ORDER BY no').all().map(publicEmp)]);
route('POST', '/api/employees', 'hr', (ctx) => {
  const e = readEmp(ctx.body); const pw = String(ctx.body.password || '');
  if (pw.length < 6) throw new HttpError(400, 'short_password');
  if (!validPhoto(ctx.body.photo)) throw new HttpError(400, 'bad_photo');
  if (ctx.body.descriptor != null && !validDesc(ctx.body.descriptor)) throw new HttpError(400, 'bad_face');
  return [201, publicEmp(createEmployee(e, ctx.body.photo, ctx.body.descriptor, pw))];
});
route('PUT', '/api/employees/:id', 'hr', (ctx) => {
  const id = Number(ctx.m[1]); const e = readEmp(ctx.body);
  const r = db.prepare('UPDATE employees SET name=?,role=?,dept=?,shift_start=?,shift_end=?,salary=?,hired=? WHERE id=?').run(e.name, e.role, e.dept, e.shift_start, e.shift_end, e.salary, e.hired, id);
  if (!r.changes) throw new HttpError(404, 'not_found');
  return [200, publicEmp(db.prepare('SELECT * FROM employees WHERE id=?').get(id))];
});
route('PUT', '/api/employees/:id/face', 'hr', (ctx) => {
  const id = Number(ctx.m[1]);
  if (!validDesc(ctx.body.descriptor) || !validPhoto(ctx.body.photo) || !ctx.body.photo) throw new HttpError(400, 'bad_face');
  const r = db.prepare('UPDATE employees SET photo=?,descriptor=? WHERE id=?').run(ctx.body.photo, JSON.stringify(ctx.body.descriptor), id);
  if (!r.changes) throw new HttpError(404, 'not_found');
  return [200, { ok: true }];
});
route('POST', '/api/employees/:id/password', 'hr', (ctx) => {
  const pw = String(ctx.body.password || ''); if (pw.length < 6) throw new HttpError(400, 'short_password');
  const acc = db.prepare('SELECT id FROM accounts WHERE emp_id=?').get(Number(ctx.m[1])); if (!acc) throw new HttpError(404, 'not_found');
  setPassword(acc.id, pw); db.prepare('DELETE FROM sessions WHERE account_id=?').run(acc.id); return [200, { ok: true }];
});
route('DELETE', '/api/employees/:id', 'hr', (ctx) => {
  const id = Number(ctx.m[1]);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE emp_id=?)').run(id);
    db.prepare('DELETE FROM accounts WHERE emp_id=?').run(id);
    db.prepare('DELETE FROM att WHERE emp_id=?').run(id); db.prepare('DELETE FROM kpi WHERE emp_id=?').run(id);
    db.prepare('DELETE FROM employees WHERE id=?').run(id); db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return [200, { ok: true }];
});

/* --- nomzodlar (qabul) --- */
route('POST', '/api/apply', 'none', (ctx) => {
  const ip = clientIp(ctx.req);
  if (limited('apply:' + ip, 15, 3600e3)) throw new HttpError(429, 'too_many'); hit('apply:' + ip);
  const b = ctx.body, name = str(b.name, 120), phone = str(b.phone, 30);
  if (!name || !phone) throw new HttpError(400, 'need_name_phone');
  if (!validPhoto(b.photo)) throw new HttpError(400, 'bad_photo');
  if (b.descriptor != null && !validDesc(b.descriptor)) throw new HttpError(400, 'bad_face');
  const lat = num(b.lat), lng = num(b.lng);
  if ((lat != null && Math.abs(lat) > 90) || (lng != null && Math.abs(lng) > 180)) throw new HttpError(400, 'bad_coords');
  db.prepare('INSERT INTO candidates(name,phone,role,salary,address,lat,lng,photo,descriptor,stage,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(name, phone, str(b.role, 100), num(b.salary), str(b.address, 300), lat, lng, b.photo || null, b.descriptor ? JSON.stringify(b.descriptor) : null, 'new', nowTk().date);
  return [201, { ok: true }];
});
route('GET', '/api/candidates', 'hr', () => [200, db.prepare('SELECT * FROM candidates ORDER BY id DESC').all().map(publicCand)]);
route('PUT', '/api/candidates/:id/stage', 'hr', (ctx) => {
  const st = str(ctx.body.stage, 20); if (!['new', 'interview', 'offer', 'hired'].includes(st)) throw new HttpError(400, 'bad_stage');
  const r = db.prepare('UPDATE candidates SET stage=? WHERE id=?').run(st, Number(ctx.m[1])); if (!r.changes) throw new HttpError(404, 'not_found'); return [200, { ok: true }];
});
route('DELETE', '/api/candidates/:id', 'hr', (ctx) => { db.prepare('DELETE FROM candidates WHERE id=?').run(Number(ctx.m[1])); return [200, { ok: true }]; });
route('POST', '/api/candidates/:id/hire', 'hr', (ctx) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(Number(ctx.m[1])); if (!c) throw new HttpError(404, 'not_found');
  const b = Object.assign({ name: c.name, role: c.role, salary: c.salary }, ctx.body); const e = readEmp(b); const pw = String(ctx.body.password || '');
  if (pw.length < 6) throw new HttpError(400, 'short_password');
  db.exec('BEGIN');
  try { var emp = createEmployee(e, c.photo, c.descriptor ? JSON.parse(c.descriptor) : null, pw); db.prepare('DELETE FROM candidates WHERE id=?').run(c.id); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
  return [201, publicEmp(emp)];
});

/* --- davomat --- */
route('POST', '/api/punch', 'employee', (ctx) => {
  const b = ctx.body, emp = db.prepare('SELECT * FROM employees WHERE id=?').get(ctx.user.empId);
  if (!emp) throw new HttpError(404, 'not_found');
  if (!emp.descriptor) throw new HttpError(409, 'no_face_enrolled');
  if (!validDesc(b.descriptor)) throw new HttpError(400, 'no_face_detected');
  const place = getSetting('place'), face = getSetting('face');
  if (place.lat == null || place.lng == null) throw new HttpError(409, 'no_workplace');
  const lat = num(b.lat), lng = num(b.lng), acc = num(b.acc) || 0;
  if (lat == null || lng == null) throw new HttpError(400, 'no_gps');
  if (acc > 150) throw new HttpError(422, 'gps_inaccurate');
  const dist = Math.round(haversine(place.lat, place.lng, lat, lng));
  if (dist > place.r) throw new HttpError(422, 'outside_workplace:' + dist);
  const fd = faceDist(JSON.parse(emp.descriptor), b.descriptor);
  if (fd > face.threshold) throw new HttpError(422, 'face_mismatch');
  if (!validPhoto(b.photo)) throw new HttpError(400, 'bad_photo');
  const t = nowTk(); const row = db.prepare('SELECT * FROM att WHERE emp_id=? AND date=?').get(emp.id, t.date);
  const photo = b.photo || null, fr = Math.round(fd * 1000) / 1000;
  if (!row) { db.prepare('INSERT INTO att(emp_id,date,in_t,in_dist,in_photo,in_face) VALUES(?,?,?,?,?,?)').run(emp.id, t.date, t.time, dist, photo, fr); return [200, { type: 'in', time: t.time, dist }]; }
  if (!row.in_t) { db.prepare('UPDATE att SET in_t=?,in_dist=?,in_photo=?,in_face=? WHERE emp_id=? AND date=?').run(t.time, dist, photo, fr, emp.id, t.date); return [200, { type: 'in', time: t.time, dist }]; }
  if (row.out_t) throw new HttpError(409, 'already_done');
  if (t.min - toMin(row.in_t) < 2) throw new HttpError(409, 'too_soon');
  db.prepare('UPDATE att SET out_t=?,out_dist=?,out_photo=?,out_face=? WHERE emp_id=? AND date=?').run(t.time, dist, photo, fr, emp.id, t.date);
  return [200, { type: 'out', time: t.time, dist }];
});
route('GET', '/api/attendance', 'user', (ctx) => {
  const u = ctx.user, q = ctx.url.searchParams; const mk = /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : nowTk().date.slice(0, 7);
  let rows;
  if (isHr(u)) rows = q.get('date') ? db.prepare('SELECT * FROM att WHERE date=?').all(q.get('date')) : db.prepare('SELECT * FROM att WHERE date LIKE ?').all(mk + '-%');
  else rows = db.prepare('SELECT * FROM att WHERE emp_id=? AND date LIKE ?').all(u.empId, mk + '-%');
  return [200, rows.map((r) => ({ empId: r.emp_id, date: r.date, in: r.in_t, out: r.out_t, inDist: r.in_dist, outDist: r.out_dist, inPhoto: isHr(u) ? r.in_photo : null, outPhoto: isHr(u) ? r.out_photo : null }))];
});
route('PUT', '/api/attendance', 'hr', (ctx) => {
  const b = ctx.body, empId = Number(b.empId), date = str(b.date, 10), tin = str(b.in, 5), tout = str(b.out, 5);
  if (!db.prepare('SELECT 1 FROM employees WHERE id=?').get(empId)) throw new HttpError(404, 'not_found');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (tin && !/^\d{2}:\d{2}$/.test(tin)) || (tout && !/^\d{2}:\d{2}$/.test(tout))) throw new HttpError(400, 'bad_date');
  if (!tin && !tout) db.prepare('DELETE FROM att WHERE emp_id=? AND date=?').run(empId, date);
  else db.prepare('INSERT INTO att(emp_id,date,in_t,out_t) VALUES(?,?,?,?) ON CONFLICT(emp_id,date) DO UPDATE SET in_t=excluded.in_t,out_t=excluded.out_t').run(empId, date, tin || null, tout || null);
  return [200, { ok: true }];
});
route('PUT', '/api/kpi', 'hr', (ctx) => {
  const empId = Number(ctx.body.empId), mk = str(ctx.body.month, 7), plan = num(ctx.body.plan);
  if (!/^\d{4}-\d{2}$/.test(mk) || plan == null || plan < 0 || plan > 100) throw new HttpError(400, 'bad_kpi');
  db.prepare('INSERT INTO kpi(emp_id,month,plan) VALUES(?,?,?) ON CONFLICT(emp_id,month) DO UPDATE SET plan=excluded.plan').run(empId, mk, plan); return [200, { ok: true }];
});
route('GET', '/api/report', 'hr', (ctx) => {
  const mk = /^\d{4}-\d{2}$/.test(ctx.url.searchParams.get('month') || '') ? ctx.url.searchParams.get('month') : nowTk().date.slice(0, 7);
  return [200, reportFor(mk)];
});
route('GET', '/api/report.csv', 'hr', (ctx) => {
  const q = ctx.url.searchParams, mk = /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : nowTk().date.slice(0, 7), lang = q.get('lang') === 'ru' ? 'ru' : 'uz';
  const dec = (n) => n.toFixed(1).replace('.', ',');
  const lines = [CSVH[lang].join(';')].concat(reportFor(mk).map((r) => [r.no, r.name, r.role, r.dept, Math.round(r.salary), r.shift, r.plan, r.att, r.abs, r.lateDays, r.lateMin, dec(r.workMin / 60), dec(r.otMin / 60), Math.round(r.gross), Math.round(r.net)].map(csvCell).join(';')));
  return [200, Buffer.from('﻿' + lines.join('\r\n'), 'utf8'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="san-hydro-${mk}.csv"` }];
});
route('GET', '/api/backup', 'admin', () => {
  const dump = {}; for (const t of ['employees', 'candidates', 'att', 'kpi', 'settings']) dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return [200, Buffer.from(JSON.stringify(dump)), { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="san-hydro-backup-${nowTk().date}.json"` }];
});

/* ---------- server ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'); const p = decodeURIComponent(url.pathname);
    for (const k in SEC) res.setHeader(k, SEC[k]);
    if (p.startsWith('/api/')) {
      let hit = null;
      for (const r of routes) { if (r.method !== req.method) continue; const m = r.re.exec(p); if (m) { hit = { r, m }; break; } }
      if (!hit) return send(res, 404, { error: 'not_found' });
      const user = session(req), a = hit.r.auth;
      if (a !== 'none') {
        if (!user) return send(res, 401, { error: 'login_required' });
        if ((a === 'hr' && !isHr(user)) || (a === 'admin' && user.role !== 'admin') || (a === 'employee' && !user.empId)) return send(res, 403, { error: 'forbidden' });
      }
      let body = {};
      if (req.method !== 'GET') {
        if (!/application\/json/.test(req.headers['content-type'] || '') && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined) return send(res, 415, { error: 'json_only' });
        body = await readBody(req);
      }
      const out = hit.r.fn({ req, res, url, body, user, m: hit.m });
      return send(res, out[0], out[1], out[2]);
    }
    let file = p === '/' ? '/index.html' : p === '/apply' ? '/apply.html' : p;
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC + path.sep) && full !== PUBLIC) return send(res, 403, 'forbidden');
    fs.readFile(full, (err, data) => {
      if (err) return send(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
    });
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.code, { error: err.message });
    if (err && /UNIQUE/.test(String(err.message))) return send(res, 409, { error: 'duplicate' });
    console.error(err); send(res, 500, { error: 'server_error' });
  }
});

/* birinchi ishga tushirish: admin hisobi */
if (!db.prepare("SELECT 1 FROM accounts WHERE role='admin'").get()) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  makeAccount('admin', pw, 'admin', null);
  console.log('==============================================');
  console.log(' Birinchi ishga tushirish. Administrator hisobi:');
  console.log('   login:  admin');
  console.log('   parol:  ' + pw + (process.env.ADMIN_PASSWORD ? '  (ADMIN_PASSWORD dan olindi)' : '  (uni saqlab qo\'ying va keyin almashtiring)'));
  console.log('==============================================');
}
if (require.main === module) server.listen(PORT, () => console.log('SAN HYDRO ENERGY HRM: http://localhost:' + PORT));
module.exports = { server, db };
