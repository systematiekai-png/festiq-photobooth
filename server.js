'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const QRCode = require('qrcode');
const archiver = require('archiver');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'photobooth';
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) { console.error('ADMIN_PASSWORD ontbreekt. Stel een wachtwoord in voordat je in productie draait.'); process.exit(1); }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
['stickers', 'music', 'frames'].forEach((d) => fs.mkdirSync(path.join(UPLOAD_DIR, d), { recursive: true }));

// ---------- database ----------
const db = new Database(path.join(DATA_DIR, 'photobooth.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  location TEXT,
  mode TEXT NOT NULL DEFAULT 'strip',
  brand_color TEXT NOT NULL DEFAULT '#ff2a93',
  welcome_text TEXT NOT NULL DEFAULT 'Tik om te starten',
  footer_text TEXT NOT NULL DEFAULT '',
  filters TEXT NOT NULL DEFAULT 'none,bw,sepia,vintage,vivid,warm,cool,glow',
  countdown INTEGER NOT NULL DEFAULT 3,
  video_seconds INTEGER NOT NULL DEFAULT 8,
  gallery_public INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  filter TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_event ON media(event_id, created_at);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stickers (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS music (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS frames (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
{ // migratie voor bestaande databases
  const cols = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  if (!cols.includes('templates')) db.exec("ALTER TABLE events ADD COLUMN templates TEXT NOT NULL DEFAULT 'b_brand'");
  if (!cols.includes('strip_shots')) db.exec('ALTER TABLE events ADD COLUMN strip_shots INTEGER NOT NULL DEFAULT 3');
  if (!cols.includes('music_id')) db.exec("ALTER TABLE events ADD COLUMN music_id TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('slowmo')) db.exec("ALTER TABLE events ADD COLUMN slowmo INTEGER NOT NULL DEFAULT 1");
  if (!cols.includes('video_frame')) db.exec("ALTER TABLE events ADD COLUMN video_frame TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE events SET mode = 'strip' WHERE mode = 'photo'"); // iPad-booth maakt altijd een fotostrip
  db.exec("UPDATE events SET brand_color = '#ff2a93' WHERE brand_color = '#7c5cff'"); // oude standaardkleur -> Festiq roze
}

const ALL_FILTERS = ['none', 'bw', 'sepia', 'vintage', 'vivid', 'warm', 'cool', 'glow'];
const MODES = ['strip', 'video'];
const VIDEO_FRAMES_BUILTIN = ['b_film', 'b_festiq']; // kaders die de booth zelf tekent

// ---------- ontwerpen (fotostrip-kaders met stickers) ----------
const STICKER_NAMES = ['star', 'sparkle', 'heart', 'clover', 'daisy', 'butterfly', 'bow', 'rainbow', 'cloud', 'bubble', 'dot', 'crown', 'drop', 'moon'];
const T = (o) => o; // korte helper voor leesbaarheid
const BASE = { style: 'plain', aspect: '4:3', photo_radius: 1.5, frame_radius: 2, tilt: 0, caption: '', show_footer: true, text_color: 'auto', filter: 'none' };
const BUILTIN_TEMPLATES = [
  { id: 'b_brand', name: 'Festiq roze', data: T({ ...BASE, frame_color: 'brand', bg_color: '#fcf8ef', bg_color2: '#ffe3f1', stickers: [
    { src: 'b:crown', x: 0.82, y: 0.07, size: 0.17, rot: 14 }, { src: 'b:sparkle', x: 0.13, y: 0.08, size: 0.1, rot: 0, color: '#ffd23f' },
    { src: 'b:drop', x: 0.91, y: 0.3, size: 0.11, rot: 20, color: '#1eb4ff' }, { src: 'b:star', x: 0.1, y: 0.55, size: 0.1, rot: -12, color: '#7c3aed' },
    { src: 'b:drop', x: 0.89, y: 0.78, size: 0.1, rot: -25, color: '#ffa41c' } ] }) },
  { id: 'b_blue', name: 'Festiq blauw', data: T({ ...BASE, frame_color: '#1eb4ff', bg_color: '#fcf8ef', bg_color2: '#d9f1ff', stickers: [
    { src: 'b:crown', x: 0.82, y: 0.07, size: 0.17, rot: 14 }, { src: 'b:heart', x: 0.12, y: 0.5, size: 0.1, rot: -14, color: '#ff2a93' },
    { src: 'b:sparkle', x: 0.88, y: 0.72, size: 0.1, rot: 0, color: '#ffd23f' }, { src: 'b:drop', x: 0.1, y: 0.86, size: 0.09, rot: -20, color: '#7c3aed' } ] }) },
  { id: 'b_orange', name: 'Festiq oranje', data: T({ ...BASE, frame_color: '#ffa41c', bg_color: '#fcf8ef', bg_color2: '#ffe6c2', stickers: [
    { src: 'b:star', x: 0.13, y: 0.07, size: 0.11, rot: -12, color: '#ff2a93' }, { src: 'b:sparkle', x: 0.88, y: 0.25, size: 0.1, rot: 0, color: '#7c3aed' },
    { src: 'b:drop', x: 0.9, y: 0.6, size: 0.1, rot: 20, color: '#1eb4ff' }, { src: 'b:heart', x: 0.11, y: 0.85, size: 0.09, rot: 12, color: '#ff2a93' } ] }) },
  { id: 'b_purple', name: 'Festiq paars', data: T({ ...BASE, frame_color: '#7c3aed', tilt: -3, bg_color: '#fcf8ef', bg_color2: '#e8dcff', stickers: [
    { src: 'b:sparkle', x: 0.85, y: 0.08, size: 0.11, rot: 0, color: '#ffd23f' }, { src: 'b:star', x: 0.1, y: 0.4, size: 0.1, rot: -15, color: '#ff2a93' },
    { src: 'b:dot', x: 0.92, y: 0.5, size: 0.07, rot: 0, color: '#1eb4ff' }, { src: 'b:drop', x: 0.12, y: 0.82, size: 0.1, rot: -30, color: '#ffa41c' } ] }) },
  { id: 'b_classic', name: 'Klassiek wit', data: T({ ...BASE, frame_color: '#ffffff', photo_radius: 0, frame_radius: 0, bg_color: '#fcf8ef', bg_color2: '#efe6d6', stickers: [] }) },
  { id: 'b_film', name: 'Filmstrip', data: T({ ...BASE, style: 'film', frame_color: '#17110d', photo_radius: 1, frame_radius: 0, text_color: '#ffa41c', bg_color: '#fcf8ef', bg_color2: '#ffe3f1', stickers: [] }) },
  { id: 'b_night', name: 'Zwart met sterren', data: T({ ...BASE, frame_color: '#111111', photo_radius: 0, frame_radius: 0, tilt: 4, bg_color: '#fcf8ef', bg_color2: '#e3d9ff', stickers: [
    { src: 'b:star', x: 0.14, y: 0.07, size: 0.1, rot: -10, color: '#ff2a93' }, { src: 'b:star', x: 0.82, y: 0.3, size: 0.1, rot: 12, color: '#ffd23f' },
    { src: 'b:star', x: 0.9, y: 0.7, size: 0.07, rot: 0, color: '#1eb4ff' }, { src: 'b:dot', x: 0.1, y: 0.42, size: 0.08, rot: 0, color: '#7c3aed' },
    { src: 'b:dot', x: 0.93, y: 0.12, size: 0.07, rot: 0, color: '#ffa41c' } ] }) },
];
const BUILTIN_IDS = BUILTIN_TEMPLATES.map((t) => t.id);
{ // evenementen die naar een verdwenen ontwerp verwijzen krijgen het Festiq-ontwerp
  const ok = new Set(BUILTIN_IDS.concat(db.prepare('SELECT id FROM templates').all().map((r) => r.id)));
  db.prepare('SELECT id, templates FROM events').all().forEach((e) => {
    const first = String(e.templates || '').split(',')[0];
    if (!ok.has(first)) db.prepare("UPDATE events SET templates = 'b_brand' WHERE id = ?").run(e.id);
  });
}
const customTemplateIds = () => db.prepare('SELECT id FROM templates').all().map((r) => r.id);
const validTemplateIds = () => BUILTIN_IDS.concat(customTemplateIds());

function cleanTemplate(d) {
  d = d || {};
  const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : def; };
  const hex = (v, def) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : def);
  const bg = hex(d.bg_color, '#f1f1f7');
  const out = {
    frame_color: d.frame_color === 'brand' ? 'brand' : hex(d.frame_color, '#ffffff'),
    bg_color: bg, bg_color2: hex(d.bg_color2, bg),
    style: d.style === 'film' ? 'film' : 'plain',
    aspect: ['4:3', '1:1', '3:4'].includes(d.aspect) ? d.aspect : '4:3',
    photo_radius: num(d.photo_radius, 0, 10, 0), frame_radius: num(d.frame_radius, 0, 10, 0), tilt: num(d.tilt, -10, 10, 0),
    caption: String(d.caption || '').slice(0, 40), show_footer: d.show_footer !== false,
    text_color: !d.text_color || d.text_color === 'auto' ? 'auto' : hex(d.text_color, 'auto'),
    filter: 'none', // filters zijn verwijderd
    stickers: [],
  };
  const uploaded = new Set(db.prepare('SELECT filename FROM stickers').all().map((r) => r.filename));
  for (const s of (Array.isArray(d.stickers) ? d.stickers : []).slice(0, 40)) {
    const src = String((s && s.src) || '');
    const ok = (src.startsWith('b:') && STICKER_NAMES.includes(src.slice(2))) || (src.startsWith('u:') && uploaded.has(src.slice(2)));
    if (!ok) continue;
    out.stickers.push({ src, x: num(s.x, -0.2, 1.2, 0.5), y: num(s.y, -0.2, 1.2, 0.5), size: num(s.size, 0.03, 0.6, 0.15), rot: num(s.rot, -180, 180, 0), ...(hex(s.color, null) ? { color: s.color } : {}) });
  }
  return out;
}
const customTemplate = (r) => ({ id: r.id, name: r.name, builtin: false, ...JSON.parse(r.data) });
const builtinTemplate = (t) => ({ id: t.id, name: t.name, builtin: true, ...cleanTemplate(t.data) });
function templateById(id) {
  const b = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (b) return builtinTemplate(b);
  const r = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  return r ? customTemplate(r) : null;
}

const slugify = (s) =>
  String(s || 'event').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'event';

function uniqueSlug(name, exceptId) {
  const base = slugify(name);
  let slug = base, n = 2;
  for (;;) {
    const row = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug);
    if (!row || row.id === exceptId) return slug;
    slug = `${base}-${n++}`;
  }
}

function cleanEvent(body, existing) {
  const e = existing || {};
  const pick = (k, d) => (body[k] !== undefined ? body[k] : e[k] !== undefined ? e[k] : d);
  const filters = String(pick('filters', 'none')).split(',').map((f) => f.trim()).filter((f) => ALL_FILTERS.includes(f));
  const color = /^#[0-9a-fA-F]{6}$/.test(pick('brand_color', '')) ? pick('brand_color') : '#ff2a93';
  const mid = String(pick('music_id', ''));
  const music_id = mid && db.prepare('SELECT id FROM music WHERE id = ?').get(mid) ? mid : '';
  const vf = String(pick('video_frame', ''));
  const video_frame = VIDEO_FRAMES_BUILTIN.includes(vf) || (vf && db.prepare('SELECT id FROM frames WHERE id = ?').get(vf)) ? vf : '';
  const validT = validTemplateIds();
  const tpls = String(pick('templates', 'b_brand')).split(',').map((f) => f.trim()).filter((f, i, a) => validT.includes(f) && a.indexOf(f) === i);
  return {
    name: String(pick('name', '')).trim().slice(0, 100),
    date: String(pick('date', '')).slice(0, 20),
    location: String(pick('location', '')).slice(0, 100),
    mode: pick('mode') === 'video' ? 'video' : 'strip',
    brand_color: color,
    welcome_text: String(pick('welcome_text', 'Tik om te starten')).slice(0, 80),
    footer_text: String(pick('footer_text', '')).slice(0, 80),
    filters: (filters.length ? filters : ['none']).join(','),
    countdown: Math.min(10, Math.max(1, parseInt(pick('countdown', 3), 10) || 3)),
    video_seconds: Math.min(30, Math.max(3, parseInt(pick('video_seconds', 8), 10) || 8)),
    gallery_public: pick('gallery_public') ? 1 : 0,
    active: pick('active') ? 1 : 0,
    templates: (tpls.length ? tpls[0] : 'b_brand'), // één vast ontwerp per evenement
    strip_shots: Math.min(4, Math.max(2, parseInt(pick('strip_shots', 3), 10) || 3)),
    music_id, video_frame,
    slowmo: pick('slowmo', 1) ? 1 : 0,
  };
}

// ---------- auth (signed cookie session) ----------
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('pb:' + ADMIN_PASSWORD).digest('hex');
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function makeToken() {
  const exp = String(Date.now() + 1000 * 60 * 60 * 24 * 14);
  return `${exp}.${sign(exp)}`;
}
function validToken(t) {
  if (!t || typeof t !== 'string') return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAdmin(req, res, next) {
  if (validToken(req.cookies.pb_admin)) return next();
  res.status(401).json({ error: 'Niet ingelogd' });
}

// ---------- app ----------
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

// login
let failures = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const f = failures.get(ip) || { n: 0, t: Date.now() };
  if (f.n >= 8 && Date.now() - f.t < 10 * 60 * 1000) return res.status(429).json({ error: 'Te veel pogingen, probeer het later opnieuw' });
  const given = Buffer.from(String(req.body.password || ''));
  const want = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
  if (!ok) { failures.set(ip, { n: f.n + 1, t: f.t }); return res.status(401).json({ error: 'Onjuist wachtwoord' }); }
  failures.delete(ip);
  res.cookie('pb_admin', makeToken(), { httpOnly: true, sameSite: 'lax', maxAge: 14 * 864e5, secure: req.secure });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie('pb_admin'); res.json({ ok: true }); });
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/me', (req, res) => res.json({ admin: validToken(req.cookies.pb_admin) }));

// ---- admin: events ----
const eventWithStats = `
  SELECT e.*,
    (SELECT COUNT(*) FROM media m WHERE m.event_id = e.id) AS media_count,
    (SELECT COUNT(*) FROM media m WHERE m.event_id = e.id AND m.kind='video') AS video_count,
    (SELECT filename FROM media m WHERE m.event_id = e.id AND m.kind!='video' ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS cover
  FROM events e`;

app.get('/api/events', requireAdmin, (req, res) => {
  res.json(db.prepare(eventWithStats + ' ORDER BY e.created_at DESC, e.id DESC').all());
});
app.get('/api/stats', requireAdmin, (req, res) => {
  const t = db.prepare(`SELECT
    (SELECT COUNT(*) FROM events) AS events,
    (SELECT COUNT(*) FROM events WHERE active=1) AS active_events,
    (SELECT COUNT(*) FROM media WHERE kind!='video') AS photos,
    (SELECT COUNT(*) FROM media WHERE kind='video') AS videos,
    (SELECT COALESCE(SUM(size),0) FROM media) AS bytes`).get();
  const perDay = db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM media
    WHERE created_at >= datetime('now','-13 days') GROUP BY day ORDER BY day`).all();
  res.json({ ...t, perDay });
});
app.post('/api/events', requireAdmin, (req, res) => {
  const e = cleanEvent(req.body);
  if (!e.name) return res.status(400).json({ error: 'Naam is verplicht' });
  const slug = uniqueSlug(e.name);
  const r = db.prepare(`INSERT INTO events (slug,name,date,location,mode,brand_color,welcome_text,footer_text,filters,countdown,video_seconds,gallery_public,active,templates,strip_shots,music_id,video_frame,slowmo)
    VALUES (@slug,@name,@date,@location,@mode,@brand_color,@welcome_text,@footer_text,@filters,@countdown,@video_seconds,@gallery_public,@active,@templates,@strip_shots,@music_id,@video_frame,@slowmo)`)
    .run({ ...e, slug, gallery_public: req.body.gallery_public === undefined ? 1 : e.gallery_public, active: req.body.active === undefined ? 1 : e.active });
  res.status(201).json(db.prepare(eventWithStats + ' WHERE e.id = ?').get(r.lastInsertRowid));
});
app.put('/api/events/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Niet gevonden' });
  const e = cleanEvent(req.body, cur);
  if (!e.name) return res.status(400).json({ error: 'Naam is verplicht' });
  db.prepare(`UPDATE events SET name=@name,date=@date,location=@location,mode=@mode,brand_color=@brand_color,welcome_text=@welcome_text,
    footer_text=@footer_text,filters=@filters,countdown=@countdown,video_seconds=@video_seconds,gallery_public=@gallery_public,active=@active,templates=@templates,strip_shots=@strip_shots,music_id=@music_id,video_frame=@video_frame,slowmo=@slowmo WHERE id=@id`)
    .run({ ...e, id: cur.id });
  res.json(db.prepare(eventWithStats + ' WHERE e.id = ?').get(cur.id));
});
app.delete('/api/events/:id', requireAdmin, (req, res) => {
  const files = db.prepare('SELECT filename FROM media WHERE event_id = ?').all(req.params.id);
  const r = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Niet gevonden' });
  files.forEach((f) => fs.rm(path.join(UPLOAD_DIR, f.filename), () => {}));
  res.json({ ok: true });
});
// ---- admin: ontwerpen ----
app.get('/api/templates', requireAdmin, (req, res) => {
  res.json({
    builtin: BUILTIN_TEMPLATES.map(builtinTemplate),
    custom: db.prepare('SELECT * FROM templates ORDER BY created_at, rowid').all().map(customTemplate),
  });
});
app.post('/api/templates', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Geef het ontwerp een naam' });
  if (db.prepare('SELECT COUNT(*) AS n FROM templates').get().n >= 60) return res.status(400).json({ error: 'Maximaal 60 eigen ontwerpen' });
  const id = 't' + crypto.randomBytes(4).toString('hex');
  db.prepare('INSERT INTO templates (id,name,data) VALUES (?,?,?)').run(id, name, JSON.stringify(cleanTemplate(req.body.data)));
  res.status(201).json(templateById(id));
});
app.put('/api/templates/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Niet gevonden' });
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Geef het ontwerp een naam' });
  db.prepare('UPDATE templates SET name = ?, data = ? WHERE id = ?').run(name, JSON.stringify(cleanTemplate(req.body.data)), cur.id);
  res.json(templateById(cur.id));
});
app.delete('/api/templates/:id', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Niet gevonden' });
  const upd = db.prepare('UPDATE events SET templates = ? WHERE id = ?');
  db.prepare('SELECT id, templates FROM events').all().forEach((e) => {
    const list = e.templates.split(',');
    if (list.includes(req.params.id)) upd.run(list.filter((t) => t !== req.params.id).join(',') || 'b_brand', e.id);
  });
  res.json({ ok: true });
});

// ---- admin: eigen stickers (PNG / WebP / JPEG) ----
const stickerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
function sniffImage(b) {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return '.webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  return null;
}
const stickerRow = (r) => ({ id: r.id, filename: r.filename, src: 'u:' + r.filename, url: '/media/stickers/' + r.filename });
app.get('/api/stickers', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM stickers ORDER BY created_at DESC, rowid DESC').all().map(stickerRow));
});
app.post('/api/stickers', requireAdmin, stickerUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand' });
  const ext = sniffImage(req.file.buffer);
  if (!ext) return res.status(415).json({ error: 'Alleen PNG, WebP of JPEG is toegestaan' });
  if (db.prepare('SELECT COUNT(*) AS n FROM stickers').get().n >= 200) return res.status(400).json({ error: 'Maximaal 200 stickers' });
  const id = crypto.randomBytes(6).toString('hex');
  const filename = id + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, 'stickers', filename), req.file.buffer);
  db.prepare('INSERT INTO stickers (id,filename) VALUES (?,?)').run(id, filename);
  res.status(201).json(stickerRow(db.prepare('SELECT * FROM stickers WHERE id = ?').get(id)));
});
app.delete('/api/stickers/:id', requireAdmin, (req, res) => {
  const st = db.prepare('SELECT * FROM stickers WHERE id = ?').get(req.params.id);
  if (!st) return res.status(404).json({ error: 'Niet gevonden' });
  db.prepare('DELETE FROM stickers WHERE id = ?').run(st.id);
  fs.rm(path.join(UPLOAD_DIR, 'stickers', st.filename), () => {});
  // haal de sticker uit alle ontwerpen
  const upd = db.prepare('UPDATE templates SET data = ? WHERE id = ?');
  db.prepare('SELECT * FROM templates').all().forEach((t) => {
    const d = JSON.parse(t.data);
    const n = d.stickers.filter((s) => s.src !== 'u:' + st.filename);
    if (n.length !== d.stickers.length) upd.run(JSON.stringify({ ...d, stickers: n }), t.id);
  });
  res.json({ ok: true });
});

// ---- admin: muziek en videokaders voor de 360°-booth ----
const cleanName = (raw, fallback) => {
  let n = String(raw || '');
  try { n = Buffer.from(n, 'latin1').toString('utf8'); } catch {} // multer levert bestandsnamen als latin1
  n = n.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[<>"]/g, '').trim().slice(0, 60);
  return n || fallback;
};
function sniffAudio(b) {
  if (b.length < 12) return null;
  if (b.slice(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return '.mp3';
  if (b.slice(4, 8).toString() === 'ftyp') return '.m4a';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE') return '.wav';
  if (b.slice(0, 4).toString() === 'OggS') return '.ogg';
  return null;
}
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const musicRow = (r) => ({ id: r.id, name: r.name, size: r.size, url: '/media/music/' + r.filename });
app.get('/api/music', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM music ORDER BY created_at DESC, rowid DESC').all().map(musicRow));
});
app.post('/api/music', requireAdmin, audioUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand' });
  const ext = sniffAudio(req.file.buffer);
  if (!ext) return res.status(415).json({ error: 'Alleen MP3, M4A, WAV of OGG is toegestaan' });
  if (db.prepare('SELECT COUNT(*) AS n FROM music').get().n >= 50) return res.status(400).json({ error: 'Maximaal 50 nummers' });
  const id = 'm' + crypto.randomBytes(5).toString('hex');
  const filename = id + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, 'music', filename), req.file.buffer);
  db.prepare('INSERT INTO music (id,name,filename,size) VALUES (?,?,?,?)').run(id, cleanName(req.body.name || req.file.originalname, 'Nummer'), filename, req.file.size);
  res.status(201).json(musicRow(db.prepare('SELECT * FROM music WHERE id = ?').get(id)));
});
app.delete('/api/music/:id', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM music WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Niet gevonden' });
  db.prepare('DELETE FROM music WHERE id = ?').run(m.id);
  db.prepare("UPDATE events SET music_id = '' WHERE music_id = ?").run(m.id);
  fs.rm(path.join(UPLOAD_DIR, 'music', m.filename), () => {});
  res.json({ ok: true });
});

const frameUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const frameRow = (r) => ({ id: r.id, name: r.name, url: '/media/frames/' + r.filename });
app.get('/api/frames', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM frames ORDER BY created_at DESC, rowid DESC').all().map(frameRow));
});
app.post('/api/frames', requireAdmin, frameUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand' });
  const ext = sniffImage(req.file.buffer);
  if (ext !== '.png' && ext !== '.webp') return res.status(415).json({ error: 'Gebruik een PNG of WebP met transparante achtergrond' });
  if (db.prepare('SELECT COUNT(*) AS n FROM frames').get().n >= 30) return res.status(400).json({ error: 'Maximaal 30 kaders' });
  const id = 'f' + crypto.randomBytes(5).toString('hex');
  const filename = id + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, 'frames', filename), req.file.buffer);
  db.prepare('INSERT INTO frames (id,name,filename) VALUES (?,?,?)').run(id, cleanName(req.body.name || req.file.originalname, 'Kader'), filename);
  res.status(201).json(frameRow(db.prepare('SELECT * FROM frames WHERE id = ?').get(id)));
});
app.delete('/api/frames/:id', requireAdmin, (req, res) => {
  const f = db.prepare('SELECT * FROM frames WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Niet gevonden' });
  db.prepare('DELETE FROM frames WHERE id = ?').run(f.id);
  db.prepare("UPDATE events SET video_frame = '' WHERE video_frame = ?").run(f.id);
  fs.rm(path.join(UPLOAD_DIR, 'frames', f.filename), () => {});
  res.json({ ok: true });
});

app.get('/api/events/:id/media', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM media WHERE event_id = ? ORDER BY created_at DESC, rowid DESC').all(req.params.id));
});
app.delete('/api/media/:id', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Niet gevonden' });
  db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
  fs.rm(path.join(UPLOAD_DIR, m.filename), () => {});
  res.json({ ok: true });
});
app.get('/api/events/:id/zip', requireAdmin, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).end();
  const rows = db.prepare('SELECT * FROM media WHERE event_id = ? ORDER BY created_at').all(ev.id);
  res.attachment(`${ev.slug}.zip`);
  const zip = archiver('zip', { store: true });
  zip.on('error', () => res.end());
  zip.pipe(res);
  rows.forEach((m, i) => {
    const p = path.join(UPLOAD_DIR, m.filename);
    if (fs.existsSync(p)) zip.file(p, { name: `${ev.slug}-${String(i + 1).padStart(3, '0')}${path.extname(m.filename)}` });
  });
  zip.finalize();
});
app.get('/api/events/:id/csv', requireAdmin, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).end();
  const rows = db.prepare('SELECT * FROM media WHERE event_id = ? ORDER BY created_at').all(ev.id);
  res.attachment(`${ev.slug}.csv`).type('text/csv');
  res.send('id,type,filter,size_bytes,created_at,url\n' + rows.map((m) => [m.id, m.kind, m.filter || '', m.size, m.created_at, `${baseUrl(req)}/p/${m.id}`].join(',')).join('\n'));
});

// ---- public: event config, upload, gallery ----
const publicEvent = (e) => ({
  id: e.id, slug: e.slug, name: e.name, date: e.date, location: e.location, mode: e.mode,
  brand_color: e.brand_color, welcome_text: e.welcome_text, footer_text: e.footer_text,
  filters: e.filters.split(','), countdown: e.countdown, video_seconds: e.video_seconds,
  gallery_public: !!e.gallery_public, active: !!e.active, strip_shots: e.strip_shots, slowmo: !!e.slowmo,
  templates: e.templates.split(',').slice(0, 1).map(templateById).filter(Boolean),
  music: (() => { const m = e.music_id && db.prepare('SELECT * FROM music WHERE id = ?').get(e.music_id); return m ? { id: m.id, name: m.name, url: '/media/music/' + m.filename } : null; })(),
  video_frame: (() => {
    if (VIDEO_FRAMES_BUILTIN.includes(e.video_frame)) return { kind: 'builtin', id: e.video_frame };
    const f = e.video_frame && db.prepare('SELECT * FROM frames WHERE id = ?').get(e.video_frame);
    return f ? { kind: 'image', id: f.id, url: '/media/frames/' + f.filename } : null;
  })(),
});
app.get('/api/public/events/:slug', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
  if (!e) return res.status(404).json({ error: 'Evenement niet gevonden' });
  res.json(publicEvent(e));
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(9).toString('hex') + '.tmp'),
  }),
  limits: { fileSize: 150 * 1024 * 1024 },
});
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'video/webm': '.webm', 'video/mp4': '.mp4' };
app.post('/api/public/events/:slug/upload', upload.single('file'), (req, res) => {
  const cleanup = () => req.file && fs.rm(req.file.path, () => {});
  const e = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
  if (!e) { cleanup(); return res.status(404).json({ error: 'Evenement niet gevonden' }); }
  if (!e.active) { cleanup(); return res.status(403).json({ error: 'Evenement is niet actief' }); }
  if (!req.file) return res.status(400).json({ error: 'Geen bestand' });
  const mime = String(req.file.mimetype).split(';')[0];
  const ext = EXT[mime];
  if (!ext) { cleanup(); return res.status(415).json({ error: 'Bestandstype niet toegestaan' }); }
  const id = crypto.randomBytes(6).toString('hex');
  const filename = id + ext;
  fs.renameSync(req.file.path, path.join(UPLOAD_DIR, filename));
  const kind = mime.startsWith('video') ? 'video' : (req.body.kind === 'strip' ? 'strip' : 'photo');
  const filter = ALL_FILTERS.includes(req.body.filter) ? req.body.filter : null;
  db.prepare('INSERT INTO media (id,event_id,kind,filename,filter,size) VALUES (?,?,?,?,?,?)').run(id, e.id, kind, filename, filter, req.file.size);
  res.status(201).json({ id, kind, url: `/p/${id}`, share: `${baseUrl(req)}/p/${id}`, file: `/media/${filename}` });
});

app.get('/api/public/events/:slug/media', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
  if (!e || !e.gallery_public) return res.status(404).json({ error: 'Galerij niet beschikbaar' });
  res.json(db.prepare('SELECT id,kind,filename,created_at FROM media WHERE event_id = ? ORDER BY created_at DESC, rowid DESC').all(e.id));
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '');
  if (!text || text.length > 500) return res.status(400).end();
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: String(req.query.fg || '#000000').slice(0, 7), light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch { res.status(400).end(); }
});

app.use('/media', express.static(UPLOAD_DIR, {
  index: false, immutable: true, maxAge: '30d',
  setHeaders: (res, p) => { if (/\.(jpg|png|webm|mp4)$/.test(p) && res.req.query.dl !== undefined) res.attachment(path.basename(p)); },
}));

// guest download page for one photo/video
app.get('/p/:id', (req, res) => {
  const m = db.prepare('SELECT m.*, e.name AS event_name, e.brand_color, e.slug, e.gallery_public FROM media m JOIN events e ON e.id = m.event_id WHERE m.id = ?').get(req.params.id);
  if (!m) return res.status(404).send(page('Niet gevonden', '<p>Deze foto bestaat niet (meer).</p>', '#7c5cff'));
  const file = `/media/${m.filename}`;
  const el = m.kind === 'video'
    ? `<video src="${file}" controls autoplay loop muted playsinline></video>`
    : `<img class="m" src="${file}" alt="Fotostrip">`;
  res.send(page(m.event_name, `${el}
    <a class="btn" href="${file}?dl" download>Download ${m.kind === 'video' ? 'video' : 'fotostrip'}</a>
    ${m.gallery_public ? `<a class="link" href="/gallery/${m.slug}">Bekijk alle foto's van dit evenement</a>` : ''}`, m.brand_color));
});
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function page(title, body, color) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="/festiq-logo.jpg"><style>
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:20px;box-sizing:border-box;
font-family:ui-rounded,"SF Pro Rounded","Arial Rounded MT Bold",-apple-system,system-ui,sans-serif;background:#fcf8ef;color:#1c1b22;text-align:center}
.logo{width:min(260px,70vw);height:auto}
h1{font-size:18px;margin:0;opacity:.75}img.m,video{max-width:100%;max-height:66vh;border-radius:16px;box-shadow:0 10px 40px #0002}
.btn{background:linear-gradient(135deg,#ff2a93,#7c3aed);color:#fff;text-decoration:none;padding:15px 32px;border-radius:999px;font-weight:700;box-shadow:0 8px 24px #ff2a9344}
.link{color:#7a7385;font-size:14px}</style></head><body><img class="logo" src="/festiq-wordmark.jpg" alt="Festiq"><h1>${esc(title)}</h1>${body}</body></html>`;
}

// ---- pages ----
const pub = path.join(__dirname, 'public');
app.get('/booth/:slug', (req, res) => res.sendFile(path.join(pub, 'booth.html')));
app.get('/gallery/:slug', (req, res) => res.sendFile(path.join(pub, 'gallery.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('/', (req, res) => res.redirect('/admin'));
app.use(express.static(pub, { index: false }));

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Bestand te groot' });
  console.error(err);
  res.status(500).json({ error: 'Serverfout' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Photobooth platform draait op http://localhost:${PORT}`);
    if (!process.env.ADMIN_PASSWORD) console.log('LET OP: standaard wachtwoord "photobooth" in gebruik. Stel ADMIN_PASSWORD in!');
  });
}
module.exports = app;
