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
['stickers', 'music', 'frames', 'strips'].forEach((d) => fs.mkdirSync(path.join(UPLOAD_DIR, d), { recursive: true }));
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.readdirSync(TMP_DIR).forEach((f) => fs.rm(path.join(TMP_DIR, f), () => {})); // opruimen na een eventuele crash

/* Zet eerst een compleet ZIP-bestand op schijf en stuur dat dan in één keer met een bekende
   Content-Length. Rechtstreeks streamen (chunked) ging soms mis via een HTTPS-tunnel (Cloudflare
   quick tunnel), die daar niet altijd goed mee overweg kan (ERR_INVALID_RESPONSE). */
function sendZip(res, downloadName, entries) {
  const tmpPath = path.join(TMP_DIR, 'z' + crypto.randomBytes(8).toString('hex') + '.zip');
  const out = fs.createWriteStream(tmpPath);
  const zip = archiver('zip', { store: true });
  let failed = false;
  const fail = (err) => { if (failed) return; failed = true; console.error('ZIP-fout:', err); try { out.destroy(); } catch {} fs.rm(tmpPath, () => {}); if (!res.headersSent) res.status(500).json({ error: 'Downloaden is niet gelukt' }); else res.end(); };
  zip.on('error', fail);
  out.on('error', fail);
  zip.pipe(out);
  entries.forEach((e) => { if (fs.existsSync(e.path)) zip.file(e.path, { name: e.name }); });
  out.on('close', () => {
    if (failed) return;
    fs.stat(tmpPath, (err, stat) => {
      if (err) return fail(err);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName.replace(/[^\w.\-]+/g, '_')}"`);
      res.setHeader('Content-Length', stat.size);
      const rs = fs.createReadStream(tmpPath);
      const cleanup = () => fs.rm(tmpPath, () => {});
      rs.on('close', cleanup);
      rs.on('error', () => { cleanup(); if (!res.headersSent) res.status(500).end(); });
      rs.pipe(res);
    });
  });
  zip.finalize();
}

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
  if (!cols.includes('ask_name')) db.exec('ALTER TABLE events ADD COLUMN ask_name INTEGER NOT NULL DEFAULT 1');
  const mcols = db.prepare('PRAGMA table_info(media)').all().map((c) => c.name);
  if (!mcols.includes('guest_name')) db.exec("ALTER TABLE media ADD COLUMN guest_name TEXT NOT NULL DEFAULT ''");
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
const customTemplate = (r) => {
  const d = JSON.parse(r.data);
  return { id: r.id, name: r.name, builtin: false, ...d, ...(d.kind === 'image' ? { image_url: '/media/strips/' + d.image } : {}) };
};
function cleanWindows(w) {
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) * 10000) / 10000 || 0));
  return (Array.isArray(w) ? w : []).slice(0, 8).map((r) => {
    const x = num(r && r.x, 0, 1), y = num(r && r.y, 0, 1);
    return { x, y, w: num(r && r.w, 0.02, 1 - x), h: num(r && r.h, 0.02, 1 - y) };
  }).filter((r) => r.w >= 0.02 && r.h >= 0.02);
}
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
    ask_name: pick('ask_name', 1) ? 1 : 0,
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

// Het HTTPS-adres van de tunnel staat in data/public_url.txt (geschreven door Start-Photobooth.command).
// Zo wijzen QR-codes altijd naar het publieke adres, ook als de booth op de Mac zelf via localhost draait.
const PUBLIC_URL_FILE = path.join(DATA_DIR, 'public_url.txt');
let pubCache = { mtime: -1, url: '' };
function filePublicUrl() {
  try {
    const st = fs.statSync(PUBLIC_URL_FILE);
    if (st.mtimeMs !== pubCache.mtime) pubCache = { mtime: st.mtimeMs, url: fs.readFileSync(PUBLIC_URL_FILE, 'utf8').trim().replace(/\/$/, '') };
    return /^https?:\/\/[^\s]+$/.test(pubCache.url) ? pubCache.url : '';
  } catch { return ''; }
}
const baseUrl = (req) => PUBLIC_URL || filePublicUrl() || `${req.protocol}://${req.get('host')}`;

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
app.get('/api/public-url', (req, res) => res.json({ url: baseUrl(req) }));
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
  const r = db.prepare(`INSERT INTO events (slug,name,date,location,mode,brand_color,welcome_text,footer_text,filters,countdown,video_seconds,gallery_public,active,templates,strip_shots,music_id,video_frame,slowmo,ask_name)
    VALUES (@slug,@name,@date,@location,@mode,@brand_color,@welcome_text,@footer_text,@filters,@countdown,@video_seconds,@gallery_public,@active,@templates,@strip_shots,@music_id,@video_frame,@slowmo,@ask_name)`)
    .run({ ...e, slug, gallery_public: req.body.gallery_public === undefined ? 1 : e.gallery_public, active: req.body.active === undefined ? 1 : e.active });
  res.status(201).json(db.prepare(eventWithStats + ' WHERE e.id = ?').get(r.lastInsertRowid));
});
app.put('/api/events/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Niet gevonden' });
  const e = cleanEvent(req.body, cur);
  if (!e.name) return res.status(400).json({ error: 'Naam is verplicht' });
  db.prepare(`UPDATE events SET name=@name,date=@date,location=@location,mode=@mode,brand_color=@brand_color,welcome_text=@welcome_text,
    footer_text=@footer_text,filters=@filters,countdown=@countdown,video_seconds=@video_seconds,gallery_public=@gallery_public,active=@active,templates=@templates,strip_shots=@strip_shots,music_id=@music_id,video_frame=@video_frame,slowmo=@slowmo,ask_name=@ask_name WHERE id=@id`)
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
  const old = JSON.parse(cur.data);
  if (old.kind === 'image') { // eigen fotostrip-afbeelding: alleen naam en vensters aanpassen
    const wins = req.body.data && req.body.data.windows ? cleanWindows(req.body.data.windows) : old.windows;
    db.prepare('UPDATE templates SET name = ?, data = ? WHERE id = ?').run(name, JSON.stringify({ ...old, windows: wins.length ? wins : old.windows }), cur.id);
    return res.json(templateById(cur.id));
  }
  db.prepare('UPDATE templates SET name = ?, data = ? WHERE id = ?').run(name, JSON.stringify(cleanTemplate(req.body.data)), cur.id);
  res.json(templateById(cur.id));
});
const stripUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.post('/api/templates/upload', requireAdmin, stripUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand' });
  const ext = sniffImage(req.file.buffer);
  if (ext !== '.png' && ext !== '.webp') return res.status(415).json({ error: 'Gebruik een PNG of WebP met transparante vensters voor de foto\'s' });
  const name = String(req.body.name || '').trim().slice(0, 40) || 'Mijn fotostrip';
  let wins; try { wins = cleanWindows(JSON.parse(req.body.windows || '[]')); } catch { wins = []; }
  if (!wins.length) return res.status(400).json({ error: 'Geen transparante vensters gevonden voor de foto\'s' });
  if (db.prepare('SELECT COUNT(*) AS n FROM templates').get().n >= 60) return res.status(400).json({ error: 'Maximaal 60 eigen ontwerpen' });
  const id = 't' + crypto.randomBytes(4).toString('hex');
  const filename = id + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, 'strips', filename), req.file.buffer);
  const iw = Math.min(10000, Math.max(16, parseInt(req.body.w, 10) || 600)), ih = Math.min(10000, Math.max(16, parseInt(req.body.h, 10) || 1800));
  const data = { ...cleanTemplate({}), kind: 'image', image: filename, image_w: iw, image_h: ih, windows: wins };
  db.prepare('INSERT INTO templates (id,name,data) VALUES (?,?,?)').run(id, name, JSON.stringify(data));
  res.status(201).json(templateById(id));
});
app.delete('/api/templates/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT data FROM templates WHERE id = ?').get(req.params.id);
  if (row) { try { const d = JSON.parse(row.data); if (d.kind === 'image') fs.rm(path.join(UPLOAD_DIR, 'strips', d.image), () => {}); } catch {} }
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
app.get('/api/events/zip', requireAdmin, (req, res) => {
  const evs = db.prepare('SELECT * FROM events ORDER BY created_at DESC, id DESC').all();
  const entries = [];
  evs.forEach((ev) => {
    const rows = db.prepare('SELECT * FROM media WHERE event_id = ? ORDER BY created_at').all(ev.id);
    rows.forEach((m, i) => entries.push({ path: path.join(UPLOAD_DIR, m.filename), name: `${ev.slug}/${ev.slug}-${String(i + 1).padStart(3, '0')}${nameSlug(m.guest_name)}${path.extname(m.filename)}` }));
  });
  sendZip(res, 'alle-evenementen.zip', entries);
});
app.get('/api/events/:id/zip', requireAdmin, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).end();
  const rows = db.prepare('SELECT * FROM media WHERE event_id = ? ORDER BY created_at').all(ev.id);
  const entries = rows.map((m, i) => ({ path: path.join(UPLOAD_DIR, m.filename), name: `${ev.slug}-${String(i + 1).padStart(3, '0')}${nameSlug(m.guest_name)}${path.extname(m.filename)}` }));
  sendZip(res, `${ev.slug}.zip`, entries);
});
app.get('/api/events/:id/csv', requireAdmin, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).end();
  const rows = db.prepare('SELECT * FROM media WHERE event_id = ? ORDER BY created_at').all(ev.id);
  res.attachment(`${ev.slug}.csv`).type('text/csv');
  const q = (v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  res.send('id,naam,type,filter,size_bytes,created_at,url\n' + rows.map((m) => [m.id, q(m.guest_name || ''), m.kind, m.filter || '', m.size, m.created_at, `${baseUrl(req)}/p/${m.id}`].join(',')).join('\n'));
});

// ---- public: event config, upload, gallery ----
// bestandsnaam-deel met de naam van de gast, bijv. "-lisa-de-vries"
const nameSlug = (n) => { const x = String(n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); return x ? '-' + x : ''; };
const publicEvent = (e) => ({
  id: e.id, slug: e.slug, name: e.name, date: e.date, location: e.location, mode: e.mode,
  brand_color: e.brand_color, welcome_text: e.welcome_text, footer_text: e.footer_text,
  filters: e.filters.split(','), countdown: e.countdown, video_seconds: e.video_seconds,
  gallery_public: !!e.gallery_public, active: !!e.active, strip_shots: (() => { const t = templateById(String(e.templates).split(',')[0]); return t && t.kind === 'image' ? t.windows.length : e.strip_shots; })(), slowmo: !!e.slowmo, ask_name: !!e.ask_name,
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
  res.json({ ...publicEvent(e), public_url: baseUrl(req) });
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
  // foto's die offline gemaakt zijn (toen het evenement nog actief was) mogen achteraf altijd nog binnenkomen
  const queued = req.body.offline === '1';
  if (!e.active && !queued) { cleanup(); return res.status(403).json({ error: 'Evenement is niet actief' }); }
  if (!req.file) return res.status(400).json({ error: 'Geen bestand' });
  const mime = String(req.file.mimetype).split(';')[0];
  const ext = EXT[mime];
  if (!ext) { cleanup(); return res.status(415).json({ error: 'Bestandstype niet toegestaan' }); }
  // De booth maakt het ID zelf, zodat de QR-code al klopt voordat de upload gelukt is (ook offline).
  const wantId = /^[a-f0-9]{12}$/.test(String(req.body.id || '')) ? String(req.body.id) : null;
  if (wantId) {
    const ex = db.prepare('SELECT * FROM media WHERE id = ?').get(wantId);
    if (ex) { // al eerder binnengekomen (bijv. antwoord ging verloren): niet dubbel opslaan
      cleanup();
      if (ex.event_id !== e.id) return res.status(409).json({ error: 'ID al in gebruik' });
      return res.status(200).json({ id: ex.id, kind: ex.kind, url: `/p/${ex.id}`, share: `${baseUrl(req)}/p/${ex.id}`, file: `/media/${ex.filename}`, duplicate: true });
    }
  }
  const id = wantId || crypto.randomBytes(6).toString('hex');
  const filename = id + ext;
  fs.renameSync(req.file.path, path.join(UPLOAD_DIR, filename));
  const kind = mime.startsWith('video') ? 'video' : (req.body.kind === 'strip' ? 'strip' : 'photo');
  const filter = ALL_FILTERS.includes(req.body.filter) ? req.body.filter : null;
  const guest = String(req.body.guest_name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
  // tijdstip van de opname (bij een upload achteraf), zodat de volgorde in de galerij klopt
  const tk = Date.parse(String(req.body.taken_at || ''));
  const taken = Number.isFinite(tk) && tk <= Date.now() + 60000 && Date.now() - tk < 30 * 864e5 ? new Date(tk).toISOString().slice(0, 19).replace('T', ' ') : null;
  db.prepare("INSERT INTO media (id,event_id,kind,filename,filter,size,guest_name,created_at) VALUES (?,?,?,?,?,?,?,COALESCE(?, datetime('now')))").run(id, e.id, kind, filename, filter, req.file.size, guest, taken);
  const name_token = crypto.randomBytes(12).toString('hex');
  nameTokens.set(id, { token: name_token, exp: Date.now() + 30 * 60 * 1000 });
  res.status(201).json({ id, kind, url: `/p/${id}`, share: `${baseUrl(req)}/p/${id}`, file: `/media/${filename}`, name_token });
});
// naam van de gast bij een net gemaakte foto zetten (alleen de booth die hem maakte heeft het token)
const nameTokens = new Map();
setInterval(() => { const now = Date.now(); nameTokens.forEach((v, k) => { if (v.exp < now) nameTokens.delete(k); }); }, 60000).unref();
app.post('/api/public/media/:id/name', (req, res) => {
  const t = nameTokens.get(req.params.id), given = String((req.body && req.body.token) || '');
  if (!t || t.exp < Date.now() || given.length !== t.token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(t.token))) return res.status(403).json({ error: 'Niet toegestaan' });
  const name = String((req.body && req.body.name) || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
  db.prepare('UPDATE media SET guest_name = ? WHERE id = ?').run(name, req.params.id);
  res.json({ ok: true, name });
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
  if (!m) {
    // Nog niet binnen? Dan wordt hij waarschijnlijk nog geüpload (bijv. na een internetstoring): blijf verversen.
    if (/^[a-f0-9]{12}$/.test(req.params.id)) {
      res.set('Cache-Control', 'no-store');
      return res.status(404).send(page('Bijna klaar…', `<meta http-equiv="refresh" content="4">
        <div style="width:54px;height:54px;border-radius:50%;border:6px solid #ff2a9333;border-top-color:#ff2a93;border-right-color:#ffa41c;animation:s 1s linear infinite"></div>
        <style>@keyframes s{to{transform:rotate(360deg)}}</style>
        <p style="max-width:340px;line-height:1.45;font-weight:600">Je foto of video wordt nog geüpload. Laat deze pagina open staan: hij verschijnt hier vanzelf zodra hij binnen is.</p>
        <p style="max-width:340px;font-size:13px;color:#7a7385">Bewaar deze link. Werkt het bij de booth even niet met internet, dan kan het iets langer duren.</p>`, '#ff2a93'));
    }
    return res.status(404).send(page('Niet gevonden', '<p>Deze foto bestaat niet (meer).</p>', '#7c5cff'));
  }
  const file = `/media/${m.filename}`;
  const isVideo = m.kind === 'video';
  const el = isVideo
    ? `<video src="${file}" controls autoplay loop muted playsinline></video>`
    : `<img class="m" src="${file}" alt="Fotostrip">`;
  const dlName = `${m.slug}${nameSlug(m.guest_name)}-${m.id}${path.extname(m.filename)}`;
  res.send(page(m.event_name, `${m.guest_name ? `<div style="font-size:20px;font-weight:800">${esc(m.guest_name)}</div>` : ''}${el}
    <a class="btn" href="${file}?dl" download="${esc(dlName)}">Download ${isVideo ? 'video' : 'fotostrip'}</a>
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

// ---- afstandsbediening: telefoon = camera (booth), Mac = bediening met live beeld ----
// Signalering via long-polling (Server-Sent Events worden door de Cloudflare-tunnel opgehouden). Het live beeld gaat via
// WebRTC rechtstreeks van telefoon naar Mac; lukt dat niet, dan stuurt de booth JPEG-beeldjes via de server (reserve).
const rooms = new Map(); // slug -> { booths: Map(id -> client), remotes: Map(id -> client), frame, frameSeq, waiters, status }
function room(slug) {
  let r = rooms.get(slug);
  if (!r) { r = { booths: new Map(), remotes: new Map(), frame: null, frameSeq: 0, waiters: [], status: null }; rooms.set(slug, r); }
  return r;
}
const newClient = () => ({ q: [], wait: null, seen: Date.now(), token: crypto.randomBytes(12).toString('hex') });
function push(c, type, data) {
  if (!c) return;
  c.q.push({ type, data });
  if (c.q.length > 300) c.q.splice(0, c.q.length - 300);
  if (c.wait) c.wait();
}
const toRemotes = (r, type, data) => r.remotes.forEach((c) => push(c, type, data));
const boothList = (r) => [...r.booths.keys()];
const cleanId = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
// opruimen: wie al 8 s niet meer pollt, is weg
setInterval(() => {
  const now = Date.now();
  rooms.forEach((r) => {
    let bGone = false, rGone = false;
    // weg = al 8 s geen nieuwe poll, of een openstaande poll die al ruim langer loopt dan kan (verbinding dood)
    const gone = (c) => (!c.wait && now - c.seen > 8000) || (c.wait && now - c.seen > 30000);
    r.booths.forEach((c, id) => { if (gone(c)) { r.booths.delete(id); bGone = true; if (r.status && r.status.from === id) r.status = null; } });
    r.remotes.forEach((c, id) => { if (gone(c)) { r.remotes.delete(id); rGone = true; } });
    if (bGone) toRemotes(r, 'booths', { booths: boothList(r) });
    if (rGone) r.booths.forEach((c) => push(c, 'remotes', { count: r.remotes.size }));
  });
}, 3000).unref();

app.get('/api/remote/:slug/poll', (req, res) => {
  const slug = req.params.slug, r = room(slug), id = cleanId(req.query.id);
  if (!id) return res.status(400).end();
  let c;
  if (req.query.role === 'booth') {
    c = r.booths.get(id);
    if (!c) {
      if (!db.prepare('SELECT 1 FROM events WHERE slug = ?').get(slug)) return res.status(404).end();
      c = newClient(); r.booths.set(id, c);
      push(c, 'welcome', { token: c.token, remotes: r.remotes.size });
      toRemotes(r, 'booths', { booths: boothList(r), joined: id });
    }
  } else {
    if (!validToken(req.cookies.pb_admin)) return res.status(401).end();
    c = r.remotes.get(id);
    if (!c) {
      c = newClient(); r.remotes.set(id, c);
      push(c, 'booths', { booths: boothList(r) });
      if (r.status && r.booths.has(r.status.from)) push(c, 'msg', r.status); // alleen status van een booth die er nog is
      r.booths.forEach((b) => push(b, 'remotes', { count: r.remotes.size }));
    }
  }
  c.seen = Date.now();
  res.set('Cache-Control', 'no-store');
  if (c.wait) c.wait(); // oudere poll van dezelfde client eerst afsluiten
  let done = false, t = null;
  const flush = () => { if (done) return; done = true; clearTimeout(t); if (c.wait === wake) c.wait = null; c.seen = Date.now(); const out = c.q; c.q = []; res.json(out); };
  const wake = () => setImmediate(flush); // kleine bundeling van berichten
  if (c.q.length) return flush();
  t = setTimeout(flush, 20000);
  c.wait = wake;
  res.on('close', () => { if (!done) { done = true; clearTimeout(t); if (c.wait === wake) c.wait = null; c.seen = Date.now(); } });
});
const boothByToken = (r, token) => { for (const [id, b] of r.booths) if (token && b.token === token) return id; return null; };
// booth -> Mac(s)
app.post('/api/remote/:slug/to-remote', (req, res) => {
  const r = room(req.params.slug), from = boothByToken(r, req.get('x-booth-token'));
  if (!from) return res.status(403).json({ error: 'Onbekende booth' });
  const msg = { ...(req.body || {}), from };
  r.booths.get(from).seen = Date.now(); // teken van leven
  if (msg.type === 'status') r.status = msg;
  if (msg.to) push(r.remotes.get(cleanId(msg.to)), 'msg', msg); else toRemotes(r, 'msg', msg);
  res.json({ ok: true });
});
// Mac -> booth(s)
app.post('/api/remote/:slug/to-booth', requireAdmin, (req, res) => {
  const r = room(req.params.slug), msg = req.body || {};
  const targets = msg.to ? [r.booths.get(cleanId(msg.to))].filter(Boolean) : [...r.booths.values()];
  targets.forEach((b) => push(b, 'msg', msg));
  res.json({ ok: true, delivered: targets.length });
});
// reserve-beeld: booth plaatst JPEG, Mac haalt de nieuwste op (wacht max. 3 s op een nieuwer beeld)
app.post('/api/remote/:slug/frame', express.raw({ type: 'image/jpeg', limit: '2mb' }), (req, res) => {
  const r = room(req.params.slug);
  if (!boothByToken(r, req.get('x-booth-token')) || !Buffer.isBuffer(req.body)) return res.status(403).end();
  r.frame = req.body; r.frameSeq++;
  const w = r.waiters; r.waiters = []; w.forEach((fn) => fn());
  res.status(204).end();
});
app.get('/api/remote/:slug/frame', requireAdmin, (req, res) => {
  const r = room(req.params.slug), after = +req.query.after || 0;
  const send = () => {
    if (!r.frame) return res.status(204).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Frame-Seq': String(r.frameSeq) }).send(r.frame);
  };
  if (r.frameSeq > after) return send();
  let done = false;
  const fn = () => { if (!done) { done = true; clearTimeout(t); send(); } };
  const t = setTimeout(() => { done = true; r.waiters = r.waiters.filter((x) => x !== fn); res.status(204).end(); }, 3000);
  r.waiters.push(fn);
  res.on('close', () => { if (!done) { done = true; clearTimeout(t); r.waiters = r.waiters.filter((x) => x !== fn); } });
});

// ---- pages ----
const pub = path.join(__dirname, 'public');
app.get('/sw.js', (req, res) => { res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }); res.sendFile(path.join(pub, 'sw.js')); });
app.get('/remote/:slug', (req, res) => res.sendFile(path.join(pub, 'remote.html')));
app.get('/booth/:slug', (req, res) => res.sendFile(path.join(pub, 'booth.html')));
// Web-app-manifest per booth: "Toevoegen aan beginscherm" / "App installeren" opent de booth dan schermvullend,
// zonder adresbalk (iPad en Android).
app.get('/booth/:slug/manifest.webmanifest', (req, res) => {
  const e = db.prepare('SELECT name, brand_color FROM events WHERE slug = ?').get(req.params.slug);
  const slug = encodeURIComponent(req.params.slug);
  res.type('application/manifest+json').set('Cache-Control', 'no-cache').send(JSON.stringify({
    name: (e ? e.name : 'Photobooth') + ' – Photobooth', short_name: e ? e.name.slice(0, 20) : 'Photobooth',
    start_url: `/booth/${slug}?kiosk`, scope: '/', id: `/booth/${slug}`,
    display: 'fullscreen', display_override: ['fullscreen', 'standalone'], orientation: 'any',
    background_color: '#14131a', theme_color: (e && e.brand_color) || '#ff2a93',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
  }));
});
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
