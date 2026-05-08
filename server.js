/**
 * Vinu & Linga — Anniversary Site
 * Storage: plain JSON files in /tmp — no SQLite, no WebAssembly
 * Works on iPhone, Android, all browsers
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

const USER_PIN  = process.env.USER_PIN  || '85191619';
const ADMIN_PIN = process.env.ADMIN_PIN || '19161916';

// ── JSON FILE STORAGE ─────────────────────────────────
const DATA_FILE = '/tmp/love-data.json';

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return { messages: [], quizScores: [], galleryViews: [], visits: [], nextId: 1 };
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data)); } catch (e) {}
}

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

// Admin sessions
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
  const data = loadData();
  data.messages.push({
    id: data.nextId++,
    content: content.trim(),
    mood: mood || 'happy',
    device: device || null,
    ip,
    created_at: new Date().toISOString()
  });
  saveData(data);
  res.json({ ok: true });
});

app.get('/api/message', (req, res) => {
  const data = loadData();
  const last = data.messages[data.messages.length - 1] || null;
  res.json(last ? { content: last.content, mood: last.mood, created_at: last.created_at } : null);
});

app.post('/api/quiz', (req, res) => {
  const { score, total, time_taken } = req.body;
  if (typeof score !== 'number') return res.status(400).json({ error: 'Bad score' });
  const data = loadData();
  data.quizScores.push({ id: data.nextId++, score, total: total || 6, time_taken: time_taken || 0, created_at: new Date().toISOString() });
  saveData(data);
  res.json({ ok: true });
});

app.post('/api/track', (req, res) => {
  const { type, page, photo_idx } = req.body;
  const data = loadData();
  if (type === 'visit' && page)
    data.visits.push({ id: data.nextId++, page: String(page), created_at: new Date().toISOString() });
  else if (type === 'photo' && typeof photo_idx === 'number')
    data.galleryViews.push({ id: data.nextId++, photo_idx, created_at: new Date().toISOString() });
  saveData(data);
  res.json({ ok: true });
});

// ── ADMIN API ─────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const data = loadData();
  const avgScore = data.quizScores.length
    ? Math.round(data.quizScores.reduce((a, s) => a + s.score * 100 / s.total, 0) / data.quizScores.length)
    : 0;
  const photoCount = {};
  data.galleryViews.forEach(v => { photoCount[v.photo_idx] = (photoCount[v.photo_idx] || 0) + 1; });
  const topPhotoIdx = Object.entries(photoCount).sort((a, b) => b[1] - a[1])[0];
  const moodCount = {};
  data.messages.forEach(m => { moodCount[m.mood] = (moodCount[m.mood] || 0) + 1; });
  const moodBreakdown = Object.entries(moodCount).map(([mood, c]) => ({ mood, c }));
  res.json({
    totalMessages: data.messages.length,
    totalVisits: data.visits.length,
    quizAttempts: data.quizScores.length,
    avgScore,
    topPhoto: topPhotoIdx ? { photo_idx: Number(topPhotoIdx[0]), c: topPhotoIdx[1] } : null,
    moodBreakdown
  });
});

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  const data = loadData();
  res.json([...data.messages].reverse());
});

app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const data = loadData();
  data.messages = data.messages.filter(m => m.id !== Number(req.params.id));
  saveData(data);
  res.json({ ok: true });
});

app.get('/api/admin/quiz-scores', requireAdmin, (req, res) => {
  const data = loadData();
  res.json([...data.quizScores].reverse().slice(0, 100));
});

// ── CATCH-ALL ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n💖 Server running at http://localhost:${PORT}`);
  console.log(`   User PIN:  ${USER_PIN}`);
  console.log(`   Admin PIN: ${ADMIN_PIN}\n`);
});
