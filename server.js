/**
 * Vinu & Linga — Anniversary Site
 * Uses sql.js (pure JS SQLite — no native compilation needed)
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

const USER_PIN  = process.env.USER_PIN  || '85191619';
const ADMIN_PIN = process.env.ADMIN_PIN || '19161916';

// ── DB SETUP (sql.js) ─────────────────────────────────
const initSqlJs = require('sql.js');
const DB_PATH   = path.join('/tmp', 'love.db');

let db;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
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

  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    return stmt.getAsObject();
  }
  return null;
}

function dbAll(sql, params = []) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  return results;
}

// ── MIDDLEWARE ────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const rateMap = new Map();
function rateLimit(ip, max = 5, ms = 60000) {
  const now = Date.now(), r = rateMap.get(ip) || { n: 0, t: now };
  if (now - r.t > ms) { rateMap.set(ip, { n: 1, t: now }); return true; }
  if (r.n >= max) return false;
  r.n++; rateMap.set(ip, r); return true;
}

const adminSessions = new Set();
function requireAdmin(req, res, next) {
  const t = req.headers['x-session'] || req.query.session;
  if (!adminSessions.has(t)) return res.status(401).json({ error: 'Unauthorised' });
  next();
}

// ── AUTH ──────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!rateLimit(ip, 10, 60000)) return res.status(429).json({ error: 'Too many attempts' });
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'No PIN' });

  if (pin === ADMIN_PIN) {
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    adminSessions.add(token);
    setTimeout(() => adminSessions.delete(token), 8 * 60 * 60 * 1000);
    return res.json({ role: 'admin', session: token });
  }
  if (pin === USER_PIN) return res.json({ role: 'user' });
  res.status(401).json({ error: 'Wrong PIN' });
});

// ── USER API ──────────────────────────────────────────
app.post('/api/message', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!rateLimit(ip, 5, 60000)) return res.status(429).json({ error: 'Slow down 💛' });
  const { content, mood, device } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Empty' });
  if (content.length > 3000) return res.status(400).json({ error: 'Too long' });
  dbRun('INSERT INTO messages (content,mood,device,ip) VALUES (?,?,?,?)',
    [content.trim(), mood || 'happy', device || null, ip]);
  res.json({ ok: true });
});

app.get('/api/message', (req, res) => {
  const row = dbGet('SELECT content,mood,created_at FROM messages ORDER BY id DESC LIMIT 1');
  res.json(row || null);
});

app.post('/api/quiz', (req, res) => {
  const { score, total, time_taken } = req.body;
  if (typeof score !== 'number') return res.status(400).json({ error: 'Bad score' });
  dbRun('INSERT INTO quiz_scores (score,total,time_taken) VALUES (?,?,?)',
    [score, total || 6, time_taken || 0]);
  res.json({ ok: true });
});

app.post('/api/track', (req, res) => {
  const { type, page, photo_idx } = req.body;
  if (type === 'visit' && page)
    dbRun('INSERT INTO visits (page) VALUES (?)', [String(page)]);
  else if (type === 'photo' && typeof photo_idx === 'number')
    dbRun('INSERT INTO gallery_views (photo_idx) VALUES (?)', [photo_idx]);
  res.json({ ok: true });
});

// ── ADMIN API ─────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalMessages = dbGet('SELECT COUNT(*) AS c FROM messages')?.c || 0;
  const totalVisits   = dbGet('SELECT COUNT(*) AS c FROM visits')?.c || 0;
  const quizAttempts  = dbGet('SELECT COUNT(*) AS c FROM quiz_scores')?.c || 0;
  const avgRow        = dbGet('SELECT AVG(score*100.0/total) AS a FROM quiz_scores');
  const topPhoto      = dbGet('SELECT photo_idx,COUNT(*) AS c FROM gallery_views GROUP BY photo_idx ORDER BY c DESC LIMIT 1');
  const moodBreakdown = dbAll("SELECT mood,COUNT(*) AS c FROM messages GROUP BY mood");
  res.json({
    totalMessages, totalVisits, quizAttempts,
    avgScore: Math.round(avgRow?.a || 0),
    topPhoto: topPhoto || null,
    moodBreakdown
  });
});

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json(dbAll('SELECT * FROM messages ORDER BY id DESC'));
});

app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  dbRun('DELETE FROM messages WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/quiz-scores', requireAdmin, (req, res) => {
  res.json(dbAll('SELECT * FROM quiz_scores ORDER BY id DESC LIMIT 100'));
});

// ── CATCH-ALL ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n💖 Server running at http://localhost:${PORT}`);
    console.log(`   User PIN:  ${USER_PIN}`);
    console.log(`   Admin PIN: ${ADMIN_PIN}\n`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
