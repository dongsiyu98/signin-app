/**
 * 签到打卡 · 真实前后端版（Node + Express + SQLite）
 * 启动：node server.js   （先 npm install）
 * 默认托管 public/ 下的前端，并提供 /api/*
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

// ---------- 读 .env（不依赖 dotenv，自己解析） ----------
if (fs.existsSync(path.join(__dirname, '.env'))) {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'signin.db');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// ---------- 日期工具 ----------
function localToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayDate() {
  const sim = process.env.SIMULATED_TODAY;
  if (sim && /^\d{4}-\d{2}-\d{2}$/.test(sim)) return sim;
  return localToday();
}
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function fmt(d) { return d.toISOString().slice(0, 10); }
function addDays(s, n) { const dt = parseDate(s); dt.setUTCDate(dt.getUTCDate() + n); return fmt(dt); }
function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }

// ---------- 数据库（Node 22.5+ 内置 SQLite，零依赖、无需编译） ----------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  cycle_days INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  refund_real_days INTEGER NOT NULL DEFAULT 0,
  task_req TEXT DEFAULT '',
  icon TEXT DEFAULT '📋',
  tiers TEXT NOT NULL,
  milestones TEXT NOT NULL,
  card_days TEXT NOT NULL,
  labels TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS participations (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  join_date TEXT NOT NULL,
  fee_paid INTEGER NOT NULL DEFAULT 1,
  cards_used INTEGER NOT NULL DEFAULT 0,
  cards_bonus INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(activity_id, user_id)
);
CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  participation_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  task_done INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(participation_id, date)
);
CREATE INDEX IF NOT EXISTS idx_part_act ON participations(activity_id);
CREATE INDEX IF NOT EXISTS idx_chk_part ON checkins(participation_id);
`);

// ---------- 工具 ----------
const uid = () => crypto.randomBytes(12).toString('hex');
const nowISO = () => new Date().toISOString();
const genToken = () => crypto.randomBytes(24).toString('hex');
function hashPass(nickname, password) {
  return crypto.createHash('sha256').update(`${nickname}:${password}:${JWT_SECRET}`).digest('hex');
}
const DEFAULT_LABELS = {
  score: '积分', fee: '参与金', feeRefund: '已退参与金',
  poolAdd: '奖池加注', card: '补签卡'
};
function arow(row) {
  if (!row) return null;
  return {
    id: row.id, creatorId: row.creator_id, name: row.name, description: row.description,
    cycleDays: row.cycle_days, fee: row.fee, refundRealDays: row.refund_real_days,
    taskReq: row.task_req, icon: row.icon,
    tiers: JSON.parse(row.tiers), milestones: JSON.parse(row.milestones),
    cardDays: JSON.parse(row.card_days), labels: { ...DEFAULT_LABELS, ...JSON.parse(row.labels) },
    createdAt: row.created_at
  };
}

// ---------- 规则引擎（后端权威计算） ----------
function tierScore(tiers, k) {
  // tiers 升序：[{day,per}]，第 k 天取第一个 day>=k 的 per；超出则用最后一档
  let last = tiers[0].per;
  for (const t of tiers) {
    last = t.per;
    if (k <= t.day) return t.per;
  }
  return last;
}
function computeState(a, p, checkins, today) {
  const signedSet = new Set(checkins.map(c => c.date));
  const realSet = new Set(checkins.filter(c => c.type === 'real').map(c => c.date));
  const lastDay = addDays(p.join_date, a.cycleDays - 1);
  const todayClamped = diffDays(p.join_date, today) < 0 ? p.join_date
    : diffDays(today, lastDay) < 0 ? lastDay : today; // 不超过周期、不早于参加日

  // 连续天数：以 today 为基准（今天没签则看昨天）
  let end = null;
  if (signedSet.has(today)) end = today;
  else if (signedSet.has(addDays(today, -1))) end = addDays(today, -1);
  let curStreak = 0;
  if (end) {
    let d = end;
    while (signedSet.has(d)) { curStreak++; d = addDays(d, -1); }
  }

  // 记分：里程碑式 —— 历史最长连续段达到哪档里程碑，就拿该档奖金（一次性发）；断签后已发的保留
  let maxStreak = 0, run = 0;
  let d = p.join_date;
  while (diffDays(d, todayClamped) >= 0) {
    if (signedSet.has(d)) { run++; maxStreak = Math.max(maxStreak, run); }
    else { run = 0; }
    d = addDays(d, 1);
  }
  let score = 0;
  for (const m of a.milestones) {
    if (maxStreak >= m.day) score += m.add;
  }

  const realDays = realSet.size;

  // 补签卡：cardDays 中各天到达其发放日(<=today)即发放；持有=已发放-已用
  let issued = 0;
  for (const cd of a.cardDays) {
    const issueDate = addDays(p.join_date, cd - 1);
    if (diffDays(issueDate, today) >= 0) issued++;
  }
  const cardsHeld = Math.max(0, issued + (p.cards_bonus || 0) - (p.cards_used || 0));

  const refunded = a.fee > 0 && realDays >= a.refundRealDays;

  const todaySigned = signedSet.has(today);
  const inCycle = diffDays(p.join_date, today) >= 0 && diffDays(today, lastDay) >= 0;
  const canCheckin = inCycle && !todaySigned;

  // 日历
  const calendar = [];
  for (let i = 1; i <= a.cycleDays; i++) {
    const date = addDays(p.join_date, i - 1);
    const c = checkins.find(x => x.date === date);
    let state = 'future';
    if (diffDays(today, date) > 0) state = 'future';
    else if (c) state = c.type === 'makeup' ? 'makeup' : 'done';
    else state = 'miss';
    calendar.push({ idx: i, date, state, taskDone: c ? !!c.task_done : false });
  }

  return {
    joined: true, joinDate: p.join_date, feePaid: !!p.fee_paid,
    curStreak, maxStreak, realDays, score, cardsHeld, cardsUsed: p.cards_used || 0,
    refunded, todaySigned, canCheckin, inCycle, calendar
  };
}
function publicState(s) { return s; }

// ---------- Express ----------
const app = express();
app.use(express.json());
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

function auth(req, res, next) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || (req.body && req.body.token));
  if (!token) return res.status(401).json({ error: '未登录' });
  const row = db.prepare('SELECT uid FROM sessions WHERE token=?').get(token);
  if (!row) return res.status(401).json({ error: '登录已失效' });
  req.uid = row.uid;
  next();
}
function ensureUser(req, res, next) {
  const u = db.prepare('SELECT id,nickname FROM users WHERE id=?').get(req.uid);
  if (!u) return res.status(401).json({ error: '用户不存在' });
  req.user = u; next();
}

// ----- 鉴权 -----
app.post('/api/auth/register', (req, res) => {
  const nickname = (req.body.nickname || '').trim();
  const password = req.body.password || '';
  if (nickname.length < 1 || nickname.length > 20) return res.status(400).json({ error: '昵称 1-20 字' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
  if (db.prepare('SELECT id FROM users WHERE nickname=?').get(nickname))
    return res.status(409).json({ error: '昵称已被占用' });
  const id = uid();
  db.prepare('INSERT INTO users(id,nickname,pass_hash,created_at) VALUES(?,?,?,?)')
    .run(id, nickname, hashPass(nickname, password), nowISO());
  const token = genToken();
  db.prepare('INSERT INTO sessions(token,uid,created_at) VALUES(?,?,?)').run(token, id, nowISO());
  res.json({ token, user: { id, nickname } });
});
app.post('/api/auth/login', (req, res) => {
  const nickname = (req.body.nickname || '').trim();
  const password = req.body.password || '';
  const u = db.prepare('SELECT * FROM users WHERE nickname=?').get(nickname);
  if (!u || u.pass_hash !== hashPass(nickname, password))
    return res.status(401).json({ error: '昵称或密码错误' });
  const token = genToken();
  db.prepare('INSERT INTO sessions(token,uid,created_at) VALUES(?,?,?)').run(token, u.id, nowISO());
  res.json({ token, user: { id: u.id, nickname: u.nickname } });
});
app.get('/api/me', auth, ensureUser, (req, res) => res.json({ user: { id: req.user.id, nickname: req.user.nickname } }));
app.get('/api/me/activities', auth, ensureUser, (req, res) => {
  const today = todayDate();
  const rows = db.prepare(`SELECT a.*, u.nickname AS creator, p.id AS pid, p.join_date, p.fee_paid, p.cards_used, p.cards_bonus
    FROM participations p JOIN activities a ON a.id=p.activity_id LEFT JOIN users u ON u.id=a.creator_id
    WHERE p.user_id=? ORDER BY p.join_date DESC`).all(req.uid);
  const out = rows.map(r => {
    const a = arow(r); a.creator = r.creator;
    const p = { join_date: r.join_date, fee_paid: r.fee_paid, cards_used: r.cards_used, cards_bonus: r.cards_bonus };
    const ch = db.prepare('SELECT * FROM checkins WHERE participation_id=?').all(r.pid);
    return { activity: a, state: computeState(a, p, ch, today) };
  });
  res.json(out);
});
app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(req.get('authorization').slice(7));
  res.json({ ok: true });
});

// ----- 活动 -----
app.get('/api/activities', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.nickname AS creator, (SELECT COUNT(*) FROM participations p WHERE p.activity_id=a.id) AS pc
    FROM activities a LEFT JOIN users u ON u.id=a.creator_id
    ORDER BY a.created_at DESC`).all();
  res.json(rows.map(r => { const a = arow(r); a.creator = r.creator; a.participantCount = r.pc; return a; }));
});
app.post('/api/activities', auth, ensureUser, (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  const cycleDays = parseInt(b.cycleDays, 10);
  const fee = parseInt(b.fee, 10) || 0;
  const refundRealDays = parseInt(b.refundRealDays, 10) || 0;
  const tiers = Array.isArray(b.tiers) ? b.tiers : [];
  const milestones = Array.isArray(b.milestones) ? b.milestones : [];
  const cardDays = Array.isArray(b.cardDays) ? b.cardDays.map(Number).filter(n => n > 0) : [];
  const labels = (b.labels && typeof b.labels === 'object') ? b.labels : {};
  if (!name) return res.status(400).json({ error: '活动名称必填' });
  if (!(cycleDays >= 1 && cycleDays <= 366)) return res.status(400).json({ error: '周期天数 1-366' });
  if (!Array.isArray(tiers) || tiers.length === 0) return res.status(400).json({ error: '档位不能为空' });
  const cleanTiers = tiers.map(t => ({ day: parseInt(t.day, 10), per: parseInt(t.per, 10) }))
    .filter(t => t.day > 0 && t.per >= 0).sort((x, y) => x.day - y.day);
  const cleanMil = milestones.map(m => ({ day: parseInt(m.day, 10), add: parseInt(m.add, 10) }))
    .filter(m => m.day > 0).sort((x, y) => x.day - y.day);
  const id = uid();
  db.prepare(`INSERT INTO activities(id,creator_id,name,description,cycle_days,fee,refund_real_days,task_req,icon,tiers,milestones,card_days,labels,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, req.uid, name, (b.description || '').trim(), cycleDays, fee, refundRealDays,
    (b.taskReq || '').trim(), (b.icon || '📋'), JSON.stringify(cleanTiers),
    JSON.stringify(cleanMil), JSON.stringify(cardDays), JSON.stringify(labels), nowISO());
  res.json({ id });
});
app.get('/api/activities/:id', auth, ensureUser, (req, res) => {
  const r = db.prepare(`SELECT a.*, u.nickname AS creator FROM activities a LEFT JOIN users u ON u.id=a.creator_id WHERE a.id=?`).get(req.params.id);
  if (!r) return res.status(404).json({ error: '活动不存在' });
  const a = arow(r); a.creator = r.creator;
  const today = todayDate();
  // 我的参与
  const myP = db.prepare('SELECT * FROM participations WHERE activity_id=? AND user_id=?').get(a.id, req.uid);
  let me = null;
  if (myP) {
    const ch = db.prepare('SELECT * FROM checkins WHERE participation_id=?').all(myP.id);
    me = computeState(a, myP, ch, today);
  }
  // 参与者排行
  const parts = db.prepare(`SELECT p.*, u.nickname AS un FROM participations p LEFT JOIN users u ON u.id=p.user_id WHERE p.activity_id=?`).all(a.id);
  const participants = parts.map(p => {
    const ch = db.prepare('SELECT * FROM checkins WHERE participation_id=?').all(p.id);
    const s = computeState(a, p, ch, today);
    return { uid: p.user_id, nickname: p.un, curStreak: s.curStreak, realDays: s.realDays, score: s.score, cardsHeld: s.cardsHeld, refunded: s.refunded, feePaid: !!p.fee_paid, isMe: p.user_id === req.uid };
  });
  res.json({ activity: a, me, participants });
});

// ----- 参加 / 签到 / 补签 -----
app.post('/api/activities/:id/join', auth, ensureUser, (req, res) => {
  const a = arow(db.prepare('SELECT * FROM activities WHERE id=?').get(req.params.id));
  if (!a) return res.status(404).json({ error: '活动不存在' });
  if (db.prepare('SELECT id FROM participations WHERE activity_id=? AND user_id=?').get(a.id, req.uid))
    return res.status(409).json({ error: '你已参加该活动' });
  const joinDate = todayDate();
  const feePaid = req.body && req.body.paid === false ? 0 : 1;
  db.prepare('INSERT INTO participations(id,activity_id,user_id,join_date,fee_paid,cards_used,cards_bonus,created_at) VALUES(?,?,?,?,?,0,0,?)')
    .run(uid(), a.id, req.uid, joinDate, feePaid, nowISO());
  res.json({ ok: true });
});
app.post('/api/activities/:id/checkin', auth, ensureUser, (req, res) => {
  const a = arow(db.prepare('SELECT * FROM activities WHERE id=?').get(req.params.id));
  if (!a) return res.status(404).json({ error: '活动不存在' });
  const p = db.prepare('SELECT * FROM participations WHERE activity_id=? AND user_id=?').get(a.id, req.uid);
  if (!p) return res.status(400).json({ error: '请先参加活动' });
  const today = todayDate();
  const lastDay = addDays(p.join_date, a.cycleDays - 1);
  if (diffDays(p.join_date, today) < 0 || diffDays(today, lastDay) < 0)
    return res.status(400).json({ error: '不在活动周期内' });
  if (db.prepare('SELECT id FROM checkins WHERE participation_id=? AND date=?').get(p.id, today))
    return res.status(409).json({ error: '今天已签到' });
  db.prepare('INSERT INTO checkins(id,participation_id,activity_id,user_id,date,type,task_done,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(uid(), p.id, a.id, req.uid, today, 'real', req.body && req.body.taskDone ? 1 : 0, nowISO());
  const ch = db.prepare('SELECT * FROM checkins WHERE participation_id=?').all(p.id);
  res.json({ state: computeState(a, p, ch, today) });
});
app.post('/api/activities/:id/makeup', auth, ensureUser, (req, res) => {
  const a = arow(db.prepare('SELECT * FROM activities WHERE id=?').get(req.params.id));
  if (!a) return res.status(404).json({ error: '活动不存在' });
  const p = db.prepare('SELECT * FROM participations WHERE activity_id=? AND user_id=?').get(a.id, req.uid);
  if (!p) return res.status(400).json({ error: '请先参加活动' });
  const today = todayDate();
  const date = req.body && req.body.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: '日期格式错误' });
  const lastDay = addDays(p.join_date, a.cycleDays - 1);
  if (diffDays(p.join_date, date) < 0 || diffDays(date, lastDay) < 0)
    return res.status(400).json({ error: '不在活动周期内' });
  if (diffDays(today, date) > 0) return res.status(400).json({ error: '不能补未来的日期' });
  if (db.prepare('SELECT id FROM checkins WHERE participation_id=? AND date=?').get(p.id, date))
    return res.status(409).json({ error: '该日已签到' });
  const s = computeState(a, p, db.prepare('SELECT * FROM checkins WHERE participation_id=?').all(p.id), today);
  if (s.cardsHeld <= 0) return res.status(400).json({ error: '没有可用的补签卡' });
  db.prepare('INSERT INTO checkins(id,participation_id,activity_id,user_id,date,type,task_done,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(uid(), p.id, a.id, req.uid, date, 'makeup', 1, nowISO());
  db.prepare('UPDATE participations SET cards_used=cards_used+1 WHERE id=?').run(p.id);
  const p2 = db.prepare('SELECT * FROM participations WHERE id=?').get(p.id);
  const ch = db.prepare('SELECT * FROM checkins WHERE participation_id=?').all(p.id);
  res.json({ state: computeState(a, p2, ch, today) });
});
app.post('/api/activities/:id/leave', auth, ensureUser, (req, res) => {
  const a = arow(db.prepare('SELECT * FROM activities WHERE id=?').get(req.params.id));
  if (!a) return res.status(404).json({ error: '活动不存在' });
  const p = db.prepare('SELECT * FROM participations WHERE activity_id=? AND user_id=?').get(a.id, req.uid);
  if (!p) return res.status(400).json({ error: '你还没参加该活动' });
  // 删除该参与下的全部签到记录，再删参与记录（纯记分，无需退真实款项）
  db.prepare('DELETE FROM checkins WHERE participation_id=?').run(p.id);
  db.prepare('DELETE FROM participations WHERE id=?').run(p.id);
  res.json({ ok: true });
});

// 举办人删除活动（级联删除其下参与记录与签到记录；纯记分，无需退真实款项）
app.delete('/api/activities/:id', auth, ensureUser, (req, res) => {
  const a = arow(db.prepare('SELECT * FROM activities WHERE id=?').get(req.params.id));
  if (!a) return res.status(404).json({ error: '活动不存在' });
  if (a.creatorId !== req.uid) return res.status(403).json({ error: '只有活动举办人才能删除活动' });
  // 先清签到，再清参与，最后删活动本体
  db.prepare('DELETE FROM checkins WHERE activity_id=?').run(a.id);
  db.prepare('DELETE FROM participations WHERE activity_id=?').run(a.id);
  db.prepare('DELETE FROM activities WHERE id=?').run(a.id);
  res.json({ ok: true });
});

// 举办人给参与者发放补签卡（叠加 cards_bonus，与系统按 cardDays 自动发放互不冲突）
app.post('/api/activities/:id/grant-card', auth, ensureUser, (req, res) => {
  const a = arow(db.prepare('SELECT * FROM activities WHERE id=?').get(req.params.id));
  if (!a) return res.status(404).json({ error: '活动不存在' });
  if (a.creatorId !== req.uid) return res.status(403).json({ error: '只有活动举办人才能发放补签卡' });
  const userId = (req.body && req.body.userId) || '';
  const count = Math.floor(Number((req.body && req.body.count) || 0));
  if (!Number.isInteger(count) || count < 1) return res.status(400).json({ error: '发放数量须为正整数' });
  if (count > 50) return res.status(400).json({ error: '单次发放不能超过 50 张' });
  const p = db.prepare('SELECT * FROM participations WHERE activity_id=? AND user_id=?').get(a.id, userId);
  if (!p) return res.status(400).json({ error: '该用户未参加本活动' });
  db.prepare('UPDATE participations SET cards_bonus = cards_bonus + ? WHERE id=?').run(count, p.id);
  const p2 = db.prepare('SELECT * FROM participations WHERE id=?').get(p.id);
  const ch = db.prepare('SELECT * FROM checkins WHERE participation_id=?').all(p.id);
  const s = computeState(a, p2, ch, todayDate());
  res.json({ ok: true, userId, cardsBonus: p2.cards_bonus, cardsHeld: s.cardsHeld });
});

// SPA 兜底
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// ---------- 导出（供单元测试，require 时不启动服务器） ----------
module.exports = { app, computeState, todayDate, addDays, diffDays, parseDate };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`签到打卡服务已启动： http://localhost:${PORT}`);
    if (process.env.SIMULATED_TODAY) console.log(`（演示日期 SIMULATED_TODAY = ${process.env.SIMULATED_TODAY}）`);
  });
}
