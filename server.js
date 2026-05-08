/**
 * Vinu & Linga — Anniversary Site
 * One login screen → two destinations:
 *   User PIN  → main site
 *   Admin PIN → admin dashboard
 */

const express  = require('express');
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── PINS ──────────────────────────────────────────────
// Change these before deploying!
const USER_PIN  = process.env.USER_PIN  || '85191619';   // partner sees this
const ADMIN_PIN = process.env.ADMIN_PIN || '19161916';   // only you know this

// ── DB ────────────────────────────────────────────────
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'love.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    mood TEXT DEFAULT 'happy',
    device TEXT, ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS quiz_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    score INTEGER NOT NULL, total INTEGER DEFAULT 6,
    time_taken INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS gallery_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_idx INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── MIDDLEWARE ────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter
const rateMap = new Map();
function rateLimit(ip, max = 5, ms = 60000) {
  const now = Date.now(), r = rateMap.get(ip) || { n: 0, t: now };
  if (now - r.t > ms) { rateMap.set(ip, { n: 1, t: now }); return true; }
  if (r.n >= max) return false;
  r.n++; rateMap.set(ip, r); return true;
}

// Admin session (simple in-memory token)
const adminSessions = new Set();
function requireAdmin(req, res, next) {
  const t = req.headers['x-session'] || req.query.session;
  if (!adminSessions.has(t)) return res.status(401).json({ error: 'Unauthorised' });
  next();
}

// ── AUTH API ──────────────────────────────────────────

// POST /api/auth  — verify PIN, return role
app.post('/api/auth', (req, res) => {
  const ip  = req.ip || 'unknown';
  if (!rateLimit(ip, 10, 60000)) return res.status(429).json({ error: 'Too many attempts' });

  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'No PIN' });

  if (pin === ADMIN_PIN) {
    // Create a simple session token
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    adminSessions.add(token);
    // Auto-expire session after 8 hours
    setTimeout(() => adminSessions.delete(token), 8 * 60 * 60 * 1000);
    return res.json({ role: 'admin', session: token });
  }

  if (pin === USER_PIN) {
    return res.json({ role: 'user' });
  }

  res.status(401).json({ error: 'Wrong PIN' });
});

// ── PUBLIC USER API ───────────────────────────────────

app.post('/api/message', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!rateLimit(ip, 5, 60000)) return res.status(429).json({ error: 'Slow down 💛' });
  const { content, mood, device } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Empty' });
  if (content.length > 3000) return res.status(400).json({ error: 'Too long' });
  const r = db.prepare('INSERT INTO messages (content,mood,device,ip) VALUES (?,?,?,?)')
              .run(content.trim(), mood || 'happy', device || null, ip);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.get('/api/message', (req, res) => {
  const row = db.prepare('SELECT content,mood,created_at FROM messages ORDER BY id DESC LIMIT 1').get();
  res.json(row || null);
});

app.post('/api/quiz', (req, res) => {
  const { score, total, time_taken } = req.body;
  if (typeof score !== 'number') return res.status(400).json({ error: 'Bad score' });
  db.prepare('INSERT INTO quiz_scores (score,total,time_taken) VALUES (?,?,?)').run(score, total || 6, time_taken || 0);
  res.json({ ok: true });
});

app.post('/api/track', (req, res) => {
  const { type, page, photo_idx } = req.body;
  if (type === 'visit' && page)
    db.prepare('INSERT INTO visits (page) VALUES (?)').run(String(page));
  else if (type === 'photo' && typeof photo_idx === 'number')
    db.prepare('INSERT INTO gallery_views (photo_idx) VALUES (?)').run(photo_idx);
  res.json({ ok: true });
});

// ── ADMIN API (session protected) ────────────────────

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json({
    totalMessages: db.prepare('SELECT COUNT(*) AS c FROM messages').get().c,
    totalVisits:   db.prepare('SELECT COUNT(*) AS c FROM visits').get().c,
    quizAttempts:  db.prepare('SELECT COUNT(*) AS c FROM quiz_scores').get().c,
    avgScore:      Math.round(db.prepare('SELECT AVG(score*100.0/total) AS a FROM quiz_scores').get().a || 0),
    topPhoto:      db.prepare('SELECT photo_idx,COUNT(*) AS c FROM gallery_views GROUP BY photo_idx ORDER BY c DESC LIMIT 1').get() || null,
    moodBreakdown: db.prepare("SELECT mood,COUNT(*) AS c FROM messages GROUP BY mood").all()
  });
});

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC').all());
});

app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/quiz-scores', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM quiz_scores ORDER BY id DESC LIMIT 100').all());
});

// ── CATCH-ALL ─────────────────────────────────────────
// Everything goes through the single index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n💖 Server running at http://localhost:${PORT}`);
  console.log(`   User PIN:  ${USER_PIN}`);
  console.log(`   Admin PIN: ${ADMIN_PIN}\n`);
});
