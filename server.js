#!/usr/bin/env node
'use strict';

const express      = require('express');
const session      = require('express-session');
const bcrypt       = require('bcryptjs');
const path         = require('path');
const fs           = require('fs');
const cron         = require('node-cron');
const { spawn }    = require('child_process');
const axios        = require('axios');
const { v4: uuidv4 } = require('uuid');

// ─── Config ───────────────────────────────────────────────────────────────────
const DATA_DIR        = path.join(__dirname, 'data');
const CONFIG_PATH     = path.join(DATA_DIR, 'config.json');
const SCHED_PATH      = path.join(DATA_DIR, 'schedules.json');
const HISTORY_PATH    = path.join(DATA_DIR, 'history.json');
const SETTINGS_PATH   = path.join(DATA_DIR, 'settings.json');
const AUTO_SCHED_PATH = path.join(DATA_DIR, 'auto_scheduler.json');
const RELAYS_PATH     = path.join(DATA_DIR, 'relays.json');
const ffmpegBin       = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpegLocal     = path.join(__dirname, 'bin', ffmpegBin);
const FFMPEG_PATH     = fs.existsSync(ffmpegLocal) ? ffmpegLocal : ffmpegBin;
const ALL_SLOTS       = ['stream01', 'stream02', 'stream03', 'stream04', 'stream05'];

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('✗  config.json not found. Run  node setup.js  first.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH));
const PORT   = config.port || 3000;

// ─── Persistence helpers ──────────────────────────────────────────────────────
const readJSON  = (p, def) => { try { return JSON.parse(fs.readFileSync(p)); } catch { return def; } };

const writeLocks = new Map();
const writeJSON = (p, d) => {
  const dataStr = JSON.stringify(d, null, 2);
  let lock = writeLocks.get(p) || Promise.resolve();
  lock = lock.then(() => fs.promises.writeFile(p, dataStr))
             .catch(err => console.error(`[FS] Error writing ${p}:`, err));
  writeLocks.set(p, lock);
};

let schedules     = readJSON(SCHED_PATH, []);
let autoScheduler = readJSON(AUTO_SCHED_PATH, {
  enabled:          false,
  searchString:     'Texas Tech',
  apiEndpoint:      'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard',
  checkTime:        '07:00',
  refreshBeforeRun: false,
  preferredSlot:    null,
  activityLog:      []
});
const MAX_HISTORY = 10;
let history  = readJSON(HISTORY_PATH, []).slice(-MAX_HISTORY);
const SETTINGS_DEFAULTS = {
  srsUrl:             'rtmp://192.168.1.125/live',
  srsWatchUrl:        'https://stream.ipnoze.com/live',
  maxSlots:           2,
  m3uAutoRefresh:     false,
  m3uRefreshTime:     '06:00',
  debugLogging:       false,
  ffmpegLogPath:      path.join(__dirname, 'logs'),
  ffmpegLogMaxSizeMb: 10,
};
let settings = { ...SETTINGS_DEFAULTS, ...readJSON(SETTINGS_PATH, {}) };

function serverLog(...args) {
  if (settings.debugLogging) console.log(...args);
}

// ─── Relay state ──────────────────────────────────────────────────────────────
// In-memory map: slot → { slot, name, url, logo, startedAt, pid, proc }
const relays = new Map();
const createRelayEngine = require('./src/relay-engine');
const { killRelay, launchStream, spawnRelay } = createRelayEngine({
  getSettings: () => settings,
  ALL_SLOTS,
  relays,
  FFMPEG_PATH,
  saveRelays: () => saveRelays(),
  logAutoActivity,
  getHistory: () => history,
  saveHistory: () => saveHistory(),
  schedules,
  saveSchedules: () => saveSchedules(),
  serverLog
});

const getRelayStates = () =>
  [...relays.values()].map(({ proc, ...r }) => r); // strip proc — not serialisable

const saveRelays = () => {
  writeJSON(RELAYS_PATH, getRelayStates());
  pushDashboardEvent('relays', { relays: getRelayStates() });
};

const saveSchedules     = () => { writeJSON(SCHED_PATH, schedules); pushDashboardEvent('schedule'); };
const saveHistory       = () => { history = history.slice(-MAX_HISTORY); writeJSON(HISTORY_PATH, history); pushDashboardEvent('history'); };
const saveSettings      = () => writeJSON(SETTINGS_PATH, settings);
const saveAutoScheduler = () => writeJSON(AUTO_SCHED_PATH, autoScheduler);

// Trim activity log to 100 on startup in case it has excess entries
if (autoScheduler.activityLog.length > 100) {
  autoScheduler.activityLog = autoScheduler.activityLog.slice(-100);
  saveAutoScheduler();
}

// ─── App ──────────────────────────────────────────────────────────────────────
class FileStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.path = options.path || path.join(DATA_DIR, 'sessions.json');
    try { this.sessions = JSON.parse(fs.readFileSync(this.path)); }
    catch (e) { this.sessions = {}; }
  }
  saveStore() { fs.writeFileSync(this.path, JSON.stringify(this.sessions)); }
  get(sid, cb) { cb(null, this.sessions[sid] || null); }
  set(sid, sess, cb) { this.sessions[sid] = sess; this.saveStore(); if(cb) cb(null); }
  destroy(sid, cb) { delete this.sessions[sid]; this.saveStore(); if(cb) cb(null); }
  touch(sid, sess, cb) { this.sessions[sid] = sess; this.saveStore(); if(cb) cb(null); }
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store:             new FileStore(),
  secret:            config.sessionSecret || 'change-me',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 90 * 24 * 60 * 60 * 1000 }  // 90 days
}));

// ─── Auth middleware ──────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
};

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ── System ────────────────────────────────────────────────────────────────────
const SERVER_BOOT_ID = Date.now().toString();
app.get('/api/ping', (req, res) => res.json({ ok: true, bootId: SERVER_BOOT_ID }));

app.post('/api/system/restart', (req, res) => {
  res.json({ ok: true });
  // Use a detached cmd process with a delay so it survives Node being killed
  setTimeout(() => {
    const proc = spawn('cmd.exe', ['/c', 'timeout /t 2 /nobreak & nssm restart StreamSched'],
      { detached: true, stdio: 'ignore', windowsHide: true });
    proc.unref();
  }, 300);
});

// ── Image proxy (fixes mixed content on HTTPS) ────────────────────────────────
app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end();
  if (!/^https?:\/\//i.test(url)) return res.status(400).end();
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    const contentType = response.headers['content-type'] || 'image/png';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(response.data);
  } catch (e) {
    res.status(404).end();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== config.username) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, config.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.authenticated = true;
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.post('/api/auth/change-password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    config.passwordHash = await bcrypt.hash(password, 12);
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH));
    cfg.passwordHash = config.passwordHash;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Protected routes ─────────────────────────────────────────────────────────
app.use(requireAuth);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => res.json(settings));
app.put('/api/settings', (req, res) => {
  const { maxSlots, ffmpegLogMaxSizeMb, ffmpegLogPath, ...rest } = req.body;
  settings = {
    ...settings,
    ...rest,
    ...(maxSlots           !== undefined ? { maxSlots:           Math.max(1, Math.min(5,   parseInt(maxSlots)           || 2))  } : {}),
    ...(ffmpegLogMaxSizeMb !== undefined ? { ffmpegLogMaxSizeMb: Math.max(1, Math.min(500, parseInt(ffmpegLogMaxSizeMb) || 10)) } : {}),
    ...(ffmpegLogPath      !== undefined ? { ffmpegLogPath:      (ffmpegLogPath || '').trim() || path.join(__dirname, 'logs')  } : {})
  };
  saveSettings();
  startM3URefreshCron();
  res.json(settings);
});

// ── Schedules ─────────────────────────────────────────────────────────────────
const resolveLogoForUrl = (url, provided) =>
  provided || (m3uMemCache?.channels || []).find(c => c.url === url)?.logo || null;

app.get('/api/schedules', (req, res) => res.json(schedules));

function buildCronFromFrequency(frequency, recurTime, recurDay) {
  const [h, m] = (recurTime || '00:00').split(':').map(Number);
  if (frequency === 'daily')   return `${m} ${h} * * *`;
  if (frequency === 'weekly')  return `${m} ${h} * * ${recurDay ?? 1}`;
  if (frequency === 'monthly') return `${m} ${h} ${recurDay ?? 1} * *`;
  return null;
}

app.post('/api/schedules', (req, res) => {
  const s = {
    id:            uuidv4(),
    name:          req.body.name          || 'Untitled',
    url:           req.body.url,
    logo:          resolveLogoForUrl(req.body.url, req.body.logo),
    scheduleType:  req.body.scheduleType  || 'once',
    runAt:         req.body.runAt         || null,
    cronExpr:      req.body.cronExpr      || null,
    frequency:     req.body.frequency     || null,
    recurTime:     req.body.recurTime     || null,
    recurDay:      req.body.recurDay      != null ? parseInt(req.body.recurDay) : null,
    preferredSlot: req.body.preferredSlot || null,
    enabled:       true,
    createdAt:     new Date().toISOString(),
    lastRun:       null,
    nextRun:       null
  };
  if (s.scheduleType === 'cron' && s.frequency) {
    s.cronExpr = buildCronFromFrequency(s.frequency, s.recurTime, s.recurDay);
  }
  if (!s.url) return res.status(400).json({ error: 'URL required' });
  schedules.push(s);
  saveSchedules();
  registerSchedule(s);
  res.status(201).json(s);
});

app.put('/api/schedules/:id', (req, res) => {
  const idx = schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  unregisterSchedule(schedules[idx].id);
  schedules[idx] = { ...schedules[idx], ...req.body, id: schedules[idx].id };
  if (req.body.recurDay != null) schedules[idx].recurDay = parseInt(req.body.recurDay);
  if (schedules[idx].scheduleType === 'cron' && schedules[idx].frequency) {
    schedules[idx].cronExpr = buildCronFromFrequency(schedules[idx].frequency, schedules[idx].recurTime, schedules[idx].recurDay);
  }
  saveSchedules();
  registerSchedule(schedules[idx]);
  res.json(schedules[idx]);
});

app.delete('/api/schedules/:id', (req, res) => {
  const idx = schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deleted = schedules[idx];
  unregisterSchedule(deleted.id);
  schedules.splice(idx, 1);
  saveSchedules();
  logAutoActivity('warn', `Schedule deleted: ${deleted.name}`);
  res.json({ ok: true });
});

// Play now — launches immediately, logs to history, no schedule entry created
app.post('/api/play-now', async (req, res) => {
  const { name, url, noHistory, logo, preferredSlot, force } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const resolvedLogo = resolveLogoForUrl(url, logo);
  if (force && preferredSlot && relays.has(preferredSlot)) {
    killRelay(preferredSlot);
    // Give SRS time to release the RTMP slot before the new publisher connects
    await new Promise(r => setTimeout(r, 1000));
  }
  const s = { id: null, name: name || 'Now', url, noHistory, logo: resolvedLogo, preferredSlot: preferredSlot || null };
  const result = await launchStream(s);
  res.json(result);
});

// ── History ────────────────────────────────────────────────────────────────────
app.get('/api/history', (req, res) => res.json(history.slice().reverse())); // newest first
app.delete('/api/history', (req, res) => { history = []; saveHistory(); res.json({ ok: true }); });

// ── Relays ────────────────────────────────────────────────────────────────────
app.get('/api/relays', (req, res) => res.json(getRelayStates()));

app.post('/api/relays/:slot/stop', (req, res) => {
  const { slot } = req.params;
  if (!ALL_SLOTS.includes(slot)) return res.status(400).json({ error: 'Invalid slot' });
  const killed = killRelay(slot);
  if (!killed) return res.status(404).json({ error: 'Slot not active' });
  res.json({ ok: true });
});

// ── M3U / Xtream ──────────────────────────────────────────────────────────────
const M3U_CACHE_PATH = path.join(DATA_DIR, 'm3u_cache.json');

let m3uMemCache = null; // { channels, fetchedAt, sourceUrl, byteSize }

async function saveM3UCacheStreamed() {
  if (!m3uMemCache) return;
  const ws = fs.createWriteStream(M3U_CACHE_PATH);
  ws.write(`{"fetchedAt":${m3uMemCache.fetchedAt},"sourceUrl":${JSON.stringify(m3uMemCache.sourceUrl)},"byteSize":${m3uMemCache.byteSize||0},"channels":[\n`);
  for (let i = 0; i < m3uMemCache.channels.length; i++) {
    const isLast = i === m3uMemCache.channels.length - 1;
    const chunk = JSON.stringify(m3uMemCache.channels[i]) + (isLast ? '\n' : ',\n');
    if (!ws.write(chunk)) await new Promise(r => ws.once('drain', r));
  }
  ws.end(']}');
  return new Promise((resolve, reject) => { ws.once('finish', resolve); ws.once('error', reject); });
}

try {
  if (fs.existsSync(M3U_CACHE_PATH)) {
    const raw = fs.readFileSync(M3U_CACHE_PATH, 'utf8');
    m3uMemCache = JSON.parse(raw);
    serverLog(`  M3U cache loaded: ${m3uMemCache.channels.length} channels from ${new Date(m3uMemCache.fetchedAt).toLocaleString()}`);
  }
} catch (e) {
  console.warn('  Could not load M3U disk cache:', e.message);
  m3uMemCache = null;
}

app.get('/api/m3u/cache-info', (req, res) => {
  if (!m3uMemCache) return res.json({ exists: false });
  res.json({
    exists:    true,
    count:     m3uMemCache.channels.length,
    fetchedAt: m3uMemCache.fetchedAt,
    sourceUrl: m3uMemCache.sourceUrl,
    byteSize:  m3uMemCache.byteSize || 0
  });
});

app.post('/api/m3u/use-cache', (req, res) => {
  if (!m3uMemCache) return res.status(404).json({ error: 'No cached M3U found on server' });
  res.json({
    ok:        true,
    count:     m3uMemCache.channels.length,
    fetchedAt: m3uMemCache.fetchedAt,
    sourceUrl: m3uMemCache.sourceUrl
  });
});

// SSE download + parse endpoint — streams progress events to the browser
app.get('/api/m3u/download', async (req, res) => {
  const url = req.query.url;
  if (!url) { res.status(400).end(); return; }
  if (!/^https?:\/\//i.test(url)) { res.status(400).end(); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

  try {
    send({ type: 'start' });

    const resp = await axios.get(url, { timeout: 120000, responseType: 'stream' });
    const total = parseInt(resp.headers['content-length'] || '0', 10);
    let received = 0;
    const chunks = [];

    resp.data.on('data', (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      if (total > 0) {
        const pct = Math.round((received / total) * 100);
        send({ type: 'progress', received, total, pct });
      } else {
        send({ type: 'progress', received, total: 0, pct: -1 });
      }
    });

    resp.data.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        send({ type: 'parsing' });
        const channels = parseM3U(raw);
        m3uMemCache = { channels, fetchedAt: Date.now(), sourceUrl: url, byteSize: received };
        saveM3UCacheStreamed()
          .catch(err => console.warn('Could not persist M3U cache:', err.message));
        logAutoActivity('info', `M3U refreshed manually — ${channels.length} channels loaded`);
        send({ type: 'done', count: channels.length });
      } catch (parseErr) {
        logAutoActivity('error', `M3U manual refresh failed: ${parseErr.message}`);
        send({ type: 'error', message: 'Parse error: ' + parseErr.message });
      }
      res.end();
    });

    resp.data.on('error', (streamErr) => {
      send({ type: 'error', message: streamErr.message });
      res.end();
    });

  } catch (e) {
    send({ type: 'error', message: e.message });
    res.end();
  }
});

app.post('/api/m3u/search', (req, res) => {
  const { query } = req.body;
  if (!m3uMemCache) return res.status(404).json({ error: 'No M3U loaded — download one or load from cache first' });
  const q = (query || '').slice(0, 100).toLowerCase().trim();
  const results = q
    ? m3uMemCache.channels.filter(c => (c.searchName || '').includes(q))
    : m3uMemCache.channels;
  res.json({ count: results.length, total: m3uMemCache.channels.length, channels: results.slice(0, 500) });
});

// ─── M3U Parser ───────────────────────────────────────────────────────────────
const parseM3U = require('./src/m3u-parser');

// ─── Scheduler engine ─────────────────────────────────────────────────────────
const cronJobs = new Map();

function registerSchedule(s) {
  if (!s.enabled) return;

  if (s.scheduleType === 'once' && s.runAt) {
    const runTime = new Date(s.runAt);
    const now     = new Date();
    if (runTime > now) {
      const delay = runTime - now;
      const timer = setTimeout(() => {
        launchStream(s);
        // delete after firing — one-time schedules don't linger
        const idx = schedules.findIndex(x => x.id === s.id);
        if (idx !== -1) { schedules.splice(idx, 1); saveSchedules(); }
        cronJobs.delete(s.id);
      }, delay);
      cronJobs.set(s.id, { type: 'timeout', handle: timer });
      const idx = schedules.findIndex(x => x.id === s.id);
      if (idx !== -1) { schedules[idx].nextRun = runTime.toISOString(); saveSchedules(); }
    }
  } else if (s.scheduleType === 'cron' && s.cronExpr) {
    if (!cron.validate(s.cronExpr)) return;
    const job = cron.schedule(s.cronExpr, () => launchStream(s));
    cronJobs.set(s.id, { type: 'cron', handle: job });
  }
}

function unregisterSchedule(id) {
  if (!cronJobs.has(id)) return;
  const j = cronJobs.get(id);
  if (j.type === 'timeout') clearTimeout(j.handle);
  if (j.type === 'cron')    j.handle.stop();
  cronJobs.delete(id);
}


// ── Auto-Scheduler ────────────────────────────────────────────────────────────
const { runAutoScheduler } = require('./src/auto-scheduler');
let autoSchedCronJob   = null;
const autoSchedSSEClients  = new Set();
const dashboardSSEClients  = new Set();

function broadcastSSE(clients, data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(msg));
}

function pushDashboardEvent(type, data = {}) {
  broadcastSSE(dashboardSSEClients, { type, ...data });
}

function logAutoActivity(type, message) {
  const entry = { type, message, timestamp: new Date().toISOString() };
  autoScheduler.activityLog.unshift(entry);
  if (autoScheduler.activityLog.length > 100) autoScheduler.activityLog.pop();
  saveAutoScheduler();
  serverLog(`[AutoSched] ${message}`);
  broadcastSSE(autoSchedSSEClients, entry);
}

async function refreshM3U() {
  if (!m3uMemCache || !m3uMemCache.sourceUrl) {
    throw new Error('No M3U source URL in cache — please load M3U manually first.');
  }
  const url = m3uMemCache.sourceUrl;
  serverLog('[M3U] Refreshing from:', url);
  const resp = await axios.get(url, { timeout: 120000, responseType: 'arraybuffer' });
  const raw = Buffer.from(resp.data).toString('utf8');
  const channels = parseM3U(raw);
  m3uMemCache = { channels, fetchedAt: Date.now(), sourceUrl: url, byteSize: resp.data.byteLength };
  await saveM3UCacheStreamed();
  serverLog(`[M3U] Refreshed: ${channels.length} channels`);
  return channels.length;
}

function startAutoSchedCron() {
  if (autoSchedCronJob) { autoSchedCronJob.stop(); autoSchedCronJob = null; }
  if (!autoScheduler.enabled || !autoScheduler.checkTime) return;
  const [h, m] = autoScheduler.checkTime.split(':');
  autoSchedCronJob = cron.schedule(`${parseInt(m)} ${parseInt(h)} * * *`, () => {
    runAutoScheduler({ autoScheduler, m3uMemCache, schedules, saveSchedules, registerSchedule, logAutoActivity, refreshM3U });
  }, { timezone: 'America/New_York' });
  serverLog(`[AutoSched] Cron set for ${autoScheduler.checkTime} ET daily`);
}

let m3uRefreshCronJob = null;
function startM3URefreshCron() {
  if (m3uRefreshCronJob) { m3uRefreshCronJob.stop(); m3uRefreshCronJob = null; }
  if (!settings.m3uAutoRefresh || !settings.m3uRefreshTime) return;
  const [h, m] = settings.m3uRefreshTime.split(':');
  m3uRefreshCronJob = cron.schedule(`${parseInt(m)} ${parseInt(h)} * * *`, async () => {
    serverLog('[M3U] Running scheduled daily refresh…');
    logAutoActivity('info', 'Refreshing M3U…');
    try {
      const count = await refreshM3U();
      serverLog(`[M3U] Daily refresh complete — ${count} channels.`);
      logAutoActivity('info', `M3U auto-refreshed — ${count} channels loaded`);
    } catch (e) {
      console.warn('[M3U] Daily refresh failed:', e.message);
      logAutoActivity('error', `M3U auto-refresh failed: ${e.message}`);
    }
  });
  serverLog(`[M3U] Auto-refresh cron set for ${settings.m3uRefreshTime} daily`);
}

// ── SSE ───────────────────────────────────────────────────────────────────────
function createSSEEndpoint(clientSet) {
  return (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    clientSet.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 30000);
    const cleanup = () => { clearInterval(heartbeat); clientSet.delete(res); };
    req.on('close', cleanup);
    res.on('error', cleanup);
  };
}

app.get('/api/events',                createSSEEndpoint(dashboardSSEClients));
app.get('/api/auto-scheduler/events', createSSEEndpoint(autoSchedSSEClients));

app.get('/api/auto-scheduler', (req, res) => res.json(autoScheduler));
app.put('/api/auto-scheduler', (req, res) => {
  autoScheduler = { ...autoScheduler, ...req.body, activityLog: autoScheduler.activityLog };
  saveAutoScheduler();
  if (autoSchedCronJob) startAutoSchedCron();
  res.json(autoScheduler);
});

app.post('/api/auto-scheduler/enable', (req, res) => {
  autoScheduler.enabled = true;
  saveAutoScheduler();
  startAutoSchedCron();
  res.json({ ok: true, enabled: true });
});

app.post('/api/auto-scheduler/disable', (req, res) => {
  autoScheduler.enabled = false;
  saveAutoScheduler();
  startAutoSchedCron();
  res.json({ ok: true, enabled: false });
});

app.post('/api/auto-scheduler/run', async (req, res) => {
  res.json({ ok: true });
  try { await runAutoScheduler({ autoScheduler, m3uMemCache, schedules, saveSchedules, registerSchedule, logAutoActivity, refreshM3U }); } catch (e) { logAutoActivity('error', 'Auto-scheduler run failed: ' + e.message); }
});

// Catch-all: serve index.html for any unmatched route (enables History API navigation)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Startup ──────────────────────────────────────────────────────────────────
// Restore relay state from previous run — kill old FFmpeg and re-spawn to get
// a full proc handle with exit event coverage (Option 2: brief stream interruption
// on restart in exchange for complete crash detection going forward).
const prevRelays = readJSON(RELAYS_PATH, []);
if (prevRelays.length > 0) {
  let respawned = 0;
  let cleared   = 0;
  for (const r of prevRelays) {
    let alive = false;
    if (r.pid) {
      try { process.kill(r.pid, 0); alive = true; } catch {}
    }
    if (alive) {
      // Kill the old detached process, then re-spawn with the same parameters
      // so we get a fresh proc handle and full exit/crash event coverage.
      try { process.kill(r.pid, 'SIGTERM'); } catch {}
      const proc = spawnRelay(r.slot, r);
      if (proc) {
        relays.set(r.slot, { slot: r.slot, name: r.name, url: r.url, logo: r.logo || null, startedAt: r.startedAt, pid: proc.pid, proc });
        respawned++;
      } else {
        logAutoActivity('error', `Failed to re-spawn relay for ${r.slot} on startup`);
        cleared++;
      }
    } else {
      cleared++;
    }
  }
  if (respawned > 0) serverLog(`[Relay] Re-spawned ${respawned} relay(s) from previous session`);
  if (cleared   > 0) serverLog(`[Relay] Cleared ${cleared} stale relay(s) from previous session`);
  writeJSON(RELAYS_PATH, getRelayStates());
}

schedules.forEach(registerSchedule);
startAutoSchedCron();
startM3URefreshCron();

// ─── Start ────────────────────────────────────────────────────────────────────
const server = require('http').createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  serverLog(`\n✓ Stream Scheduler running at http://0.0.0.0:${PORT}`);
  serverLog(`  Open http://localhost:${PORT} in your browser\n`);
  logAutoActivity('info', 'Service started');
});
