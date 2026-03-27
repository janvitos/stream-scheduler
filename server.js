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
const FFMPEG_PATH     = path.join(__dirname, 'bin', 'ffmpeg.exe');
const ALL_SLOTS       = ['stream01', 'stream02', 'stream03', 'stream04', 'stream05'];

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('✗  config.json not found. Run  node setup.js  first.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH));
const PORT   = config.port || 3000;

// ─── Persistence helpers ──────────────────────────────────────────────────────
const readJSON  = (p, def) => { try { return JSON.parse(fs.readFileSync(p)); } catch { return def; } };
const writeJSON = (p, d)   => fs.writeFileSync(p, JSON.stringify(d, null, 2));

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
let settings = readJSON(SETTINGS_PATH, {
  srsUrl:         'rtmp://192.168.1.125/live',
  srsWatchUrl:    'https://stream.ipnoze.com/live',
  maxSlots:       2,
  m3uAutoRefresh: false,
  m3uRefreshTime: '06:00'
});

// ─── Relay state ──────────────────────────────────────────────────────────────
// In-memory map: slot → { slot, name, url, logo, startedAt, pid, proc }
const relays = new Map();

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

// Trim activity log to 10 on startup in case it has excess entries
if (autoScheduler.activityLog.length > 10) {
  autoScheduler.activityLog = autoScheduler.activityLog.slice(-10);
  saveAutoScheduler();
}

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
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
  const { maxSlots, ...rest } = req.body;
  settings = {
    ...settings,
    ...rest,
    ...(maxSlots !== undefined ? { maxSlots: Math.max(1, Math.min(5, parseInt(maxSlots) || 2)) } : {})
  };
  saveSettings();
  startM3URefreshCron();
  res.json(settings);
});

// ── Schedules ─────────────────────────────────────────────────────────────────
app.get('/api/schedules', (req, res) => res.json(schedules));

app.post('/api/schedules', (req, res) => {
  const s = {
    id:           uuidv4(),
    name:         req.body.name        || 'Untitled',
    url:          req.body.url,
    logo:         req.body.logo || (m3uMemCache?.channels || []).find(c => c.url === req.body.url)?.logo || null,
    scheduleType:  req.body.scheduleType  || 'once',
    runAt:         req.body.runAt         || null,
    cronExpr:      req.body.cronExpr      || null,
    preferredSlot: req.body.preferredSlot || null,
    enabled:       true,
    createdAt:    new Date().toISOString(),
    lastRun:      null,
    nextRun:      null
  };
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
  const { name, url, noHistory, logo } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const resolvedLogo = logo || (m3uMemCache?.channels || []).find(c => c.url === url)?.logo || null;
  const { preferredSlot } = req.body;
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

try {
  if (fs.existsSync(M3U_CACHE_PATH)) {
    const raw = fs.readFileSync(M3U_CACHE_PATH, 'utf8');
    m3uMemCache = JSON.parse(raw);
    console.log(`  M3U cache loaded: ${m3uMemCache.channels.length} channels from ${new Date(m3uMemCache.fetchedAt).toLocaleString()}`);
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
        fs.writeFile(M3U_CACHE_PATH, JSON.stringify(m3uMemCache), (err) => {
          if (err) console.warn('Could not persist M3U cache:', err.message);
        });
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
  const q = (query || '').toLowerCase().trim();
  const results = q
    ? m3uMemCache.channels.filter(c => (c.name || '').toLowerCase().includes(q))
    : m3uMemCache.channels;
  res.json({ count: results.length, total: m3uMemCache.channels.length, channels: results.slice(0, 500) });
});

// ─── M3U Parser ───────────────────────────────────────────────────────────────
function parseM3U(text) {
  const lines    = text.split(/\r?\n/);
  const channels = [];
  let   meta     = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      meta = { name: '', logo: '', group: '', id: '', eventTime: null };

      const nameMatch  = line.match(/,(.+)$/);
      const logoMatch  = line.match(/tvg-logo="([^"]*)"/);
      const groupMatch = line.match(/group-title="([^"]*)"/);
      const idMatch    = line.match(/tvg-id="([^"]*)"/);
      const tvgName    = line.match(/tvg-name="([^"]*)"/);

      if (logoMatch)  meta.logo  = logoMatch[1];
      if (groupMatch) meta.group = groupMatch[1];
      if (idMatch)    meta.id    = idMatch[1];

      // Use tvg-name as display name when available — it has the full "Channel | Event" string.
      // Extract ISO date before stripping it, store in eventTime for the frontend.
      const rawName = (tvgName && tvgName[1]) ? tvgName[1] : (nameMatch ? nameMatch[1].trim() : '');
      const isoMatch = rawName.match(/\((\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?\)\s*$/);
      if (isoMatch) {
        const year = parseInt(isoMatch[1].slice(0, 4), 10);
        if (year >= 2020 && year <= 2097) meta.eventTime = isoMatch[1] + 'T' + isoMatch[2];
      }
      meta.name = rawName.replace(/\s*\(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?\)\s*$/, '').replace(/\s*\|\s*$/, '').trim();
      if (!meta.name && nameMatch) meta.name = nameMatch[1].trim();

    } else if (line && !line.startsWith('#') && meta !== null) {
      if (!meta.name) meta.name = line;
      channels.push({ ...meta, url: line });
      meta = null;
    }
  }
  return channels;
}

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
  if (j.type === 'cron')    j.handle.destroy();
  cronJobs.delete(id);
}

// ─── Relay engine ─────────────────────────────────────────────────────────────

function findFreeSlot(preferred) {
  const max = Math.max(1, Math.min(5, settings.maxSlots || 2));
  // Try preferred slot first if valid and free
  if (preferred && ALL_SLOTS.includes(preferred) && ALL_SLOTS.indexOf(preferred) < max && !relays.has(preferred)) {
    return preferred;
  }
  // Fall back to first available slot
  for (let i = 0; i < max; i++) {
    if (!relays.has(ALL_SLOTS[i])) return ALL_SLOTS[i];
  }
  return null;
}

function spawnRelay(slot, s) {
  const outputUrl = `${settings.srsUrl.replace(/\/$/, '')}/${slot}`;
  const args = [
    '-re',
    '-fflags', '+genpts+discardcorrupt',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-i', s.url,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '23',
    '-g', '60',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', 'flv',
    outputUrl
  ];

  let proc;
  try {
    proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.error(`[Relay] Failed to spawn FFmpeg for ${slot}:`, e.message);
    return null;
  }

  proc.stderr.on('data', d => {
    const line = d.toString().split('\n').find(l => /error|failed|rtmp/i.test(l));
    if (line) console.log(`[Relay:${slot}]`, line.trim());
  });

  proc.on('error', e => console.error(`[Relay:${slot}] FFmpeg error:`, e.message));

  proc.on('exit', (code) => {
    console.log(`[Relay:${slot}] FFmpeg exited, code: ${code}`);
    if (code !== 0 && code !== null) {
      logAutoActivity('error', `Relay ${slot} stopped unexpectedly (exit code ${code})`);
    }
    if (relays.has(slot)) {
      relays.delete(slot);
      saveRelays();
    }
  });

  return proc;
}

function killRelay(slot) {
  const relay = relays.get(slot);
  if (!relay) return false;
  if (relay.proc) {
    relay.proc.kill('SIGKILL');
  } else if (relay.pid) {
    try { process.kill(relay.pid, 'SIGKILL'); } catch {}
  }
  relays.delete(slot);
  saveRelays();
  return true;
}

const launching = new Set();

async function launchStream(s) {
  const slot = findFreeSlot(s.preferredSlot);
  if (!slot) {
    const msg = `No relay slots available (max ${settings.maxSlots || 2})`;
    logAutoActivity('error', msg);
    return { ok: false, error: msg };
  }

  if (launching.has(slot)) return { ok: false, error: `Slot ${slot} is already being launched` };
  launching.add(slot);

  const proc = spawnRelay(slot, s);
  if (!proc) { launching.delete(slot); return { ok: false, error: 'Failed to spawn FFmpeg' }; }

  const startedAt = new Date().toISOString();
  relays.set(slot, { slot, name: s.name, url: s.url, logo: s.logo || null, startedAt, pid: proc.pid, proc });
  launching.delete(slot);
  saveRelays();

  // Log history after relay is confirmed started
  if (!s.noHistory) {
    const latest = history[history.length - 1];
    if (!latest || latest.url !== s.url) {
      history.push({
        id:           uuidv4(),
        scheduleId:   s.id,
        scheduleName: s.name,
        url:          s.url,
        logo:         s.logo || null,
        player:       slot,
        startedAt,
        status:       'launched'
      });
      saveHistory();
    }
  }

  const idx = schedules.findIndex(x => x.id === s.id);
  if (idx !== -1) { schedules[idx].lastRun = startedAt; saveSchedules(); }

  console.log(`[Relay] Spawned ${slot} for ${s.url}`);
  return { ok: true, slot };
}

// ── Auto-Scheduler ────────────────────────────────────────────────────────────
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
  if (autoScheduler.activityLog.length > 10) autoScheduler.activityLog.pop();
  saveAutoScheduler();
  console.log(`[AutoSched] ${message}`);
  broadcastSSE(autoSchedSSEClients, entry);
}

async function refreshM3U() {
  if (!m3uMemCache || !m3uMemCache.sourceUrl) {
    throw new Error('No M3U source URL in cache — please load M3U manually first.');
  }
  const url = m3uMemCache.sourceUrl;
  console.log('[M3U] Refreshing from:', url);
  const resp = await axios.get(url, { timeout: 120000, responseType: 'arraybuffer' });
  const raw = Buffer.from(resp.data).toString('utf8');
  const channels = parseM3U(raw);
  m3uMemCache = { channels, fetchedAt: Date.now(), sourceUrl: url, byteSize: resp.data.byteLength };
  await fs.promises.writeFile(M3U_CACHE_PATH, JSON.stringify(m3uMemCache));
  console.log(`[M3U] Refreshed: ${channels.length} channels`);
  return channels.length;
}

async function runAutoScheduler() {
  logAutoActivity('info', 'Running daily check…');
  const { searchString, apiEndpoint } = autoScheduler;

  if (!searchString || !apiEndpoint) {
    logAutoActivity('error', 'Search string or API endpoint not configured');
    return;
  }
  if (!m3uMemCache || !m3uMemCache.sourceUrl) {
    logAutoActivity('error', 'M3U cache not loaded — please load M3U manually first');
    return;
  }

  if (autoScheduler.refreshBeforeRun) {
    try {
      logAutoActivity('info', 'Refreshing M3U…');
      const count = await refreshM3U();
      logAutoActivity('info', `M3U refreshed — ${count} channels loaded`);
    } catch (e) {
      logAutoActivity('error', `M3U refresh failed: ${e.message}`);
      return;
    }
  }

  const now    = new Date();
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const yyyy   = etDate.getFullYear();
  const mm     = String(etDate.getMonth() + 1).padStart(2, '0');
  const dd     = String(etDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const friendlyDate = `${monthNames[etDate.getMonth()]} ${etDate.getDate()}`;

  let events;
  try {
    const resp = await axios.get(`${apiEndpoint}?dates=${dateStr}`, { timeout: 10000 });
    events = resp.data.events || [];
  } catch (e) {
    logAutoActivity('error', `API error: ${e.message}`);
    return;
  }

  const matches = events.filter(ev => {
    const competitors = ev.competitions?.[0]?.competitors || [];
    return competitors.some(c =>
      c.team?.displayName?.toLowerCase().includes(searchString.toLowerCase()) ||
      c.team?.location?.toLowerCase().includes(searchString.toLowerCase())
    );
  });

  if (matches.length === 0) {
    logAutoActivity('info', `No ${searchString} games found today (${friendlyDate})`);
    return;
  }

  for (const ev of matches) {
    const gameName = ev.name;

    const gameUtc = new Date(ev.date);
    const gameEt  = new Date(gameUtc.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    gameEt.setMinutes(gameEt.getMinutes() + 10);
    const hh  = String(gameEt.getHours()).padStart(2, '0');
    const min = String(gameEt.getMinutes()).padStart(2, '0');
    const runAt = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

    const channels = m3uMemCache.channels || [];
    const search   = searchString.toLowerCase();
    const dateLow  = friendlyDate.toLowerCase();

    const competitors = ev.competitions?.[0]?.competitors || [];
    const opponent = competitors
      .find(c => !c.team?.displayName?.toLowerCase().includes(searchString.toLowerCase()) &&
                 !c.team?.location?.toLowerCase().includes(searchString.toLowerCase()))
      ?.team?.location?.toLowerCase() || null;

    let matching = channels.filter(ch => {
      const name = (ch.name || '').toLowerCase();
      return name.includes(search) && name.includes(dateLow);
    });

    if (matching.length > 1 && opponent) {
      const byOpponent = matching.filter(ch => ch.name.toLowerCase().includes(opponent));
      if (byOpponent.length > 0) matching = byOpponent;
    }

    if (matching.length === 0) {
      logAutoActivity('warn', `Found ${gameName} but no M3U channel matched ${searchString} on ${friendlyDate}`);
      continue;
    }

    const ch = matching[0];

    let schedHH = hh, schedMin = min, schedRunAt = runAt;
    if (ch.eventTime) {
      const [datePart, timePart] = ch.eventTime.split('T');
      const [evHH, evMM] = timePart.split(':').map(Number);
      const evWithOffset = evMM + 10;
      schedHH  = String(evHH + Math.floor(evWithOffset / 60)).padStart(2, '0');
      schedMin = String(evWithOffset % 60).padStart(2, '0');
      schedRunAt = `${datePart}T${schedHH}:${schedMin}`;
    }

    const isDuplicate = schedules.some(s =>
      s.url === ch.url && s.runAt && s.runAt.startsWith(`${yyyy}-${mm}-${dd}`)
    );
    if (isDuplicate) {
      logAutoActivity('info', `${gameName} already scheduled — skipping`);
      continue;
    }

    const s = {
      id:            uuidv4(),
      name:          ch.name,
      url:           ch.url,
      logo:          ch.logo || null,
      scheduleType:  'once',
      runAt:         schedRunAt,
      preferredSlot: autoScheduler.preferredSlot || null,
      enabled:       true,
      createdAt:     new Date().toISOString(),
      lastRun:       null
    };
    schedules.push(s);
    saveSchedules();
    registerSchedule(s);
    const h24 = parseInt(schedHH, 10);
    const fmtTime = `${h24 % 12 || 12}:${schedMin} ${h24 >= 12 ? 'PM' : 'AM'}`;
    logAutoActivity('success', `Scheduled ${gameName} at ${fmtTime} ET (+10 min) → ${ch.name}`);
  }
}

function startAutoSchedCron() {
  if (autoSchedCronJob) { autoSchedCronJob.stop(); autoSchedCronJob = null; }
  if (!autoScheduler.enabled || !autoScheduler.checkTime) return;
  const [h, m] = autoScheduler.checkTime.split(':');
  autoSchedCronJob = cron.schedule(`${parseInt(m)} ${parseInt(h)} * * *`, runAutoScheduler, { timezone: 'America/New_York' });
  console.log(`[AutoSched] Cron set for ${autoScheduler.checkTime} ET daily`);
}

let m3uRefreshCronJob = null;
function startM3URefreshCron() {
  if (m3uRefreshCronJob) { m3uRefreshCronJob.stop(); m3uRefreshCronJob = null; }
  if (!settings.m3uAutoRefresh || !settings.m3uRefreshTime) return;
  const [h, m] = settings.m3uRefreshTime.split(':');
  m3uRefreshCronJob = cron.schedule(`${parseInt(m)} ${parseInt(h)} * * *`, async () => {
    console.log('[M3U] Running scheduled daily refresh…');
    logAutoActivity('info', 'Refreshing M3U…');
    try {
      const count = await refreshM3U();
      console.log(`[M3U] Daily refresh complete — ${count} channels.`);
      logAutoActivity('info', `M3U auto-refreshed — ${count} channels loaded`);
    } catch (e) {
      console.warn('[M3U] Daily refresh failed:', e.message);
      logAutoActivity('error', `M3U auto-refresh failed: ${e.message}`);
    }
  });
  console.log(`[M3U] Auto-refresh cron set for ${settings.m3uRefreshTime} daily`);
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
    req.on('close', () => { clearInterval(heartbeat); clientSet.delete(res); });
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

app.post('/api/auto-scheduler/run', async (req, res) => { res.json({ ok: true }); await runAutoScheduler(); });

// Catch-all: serve index.html for any unmatched route (enables History API navigation)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Startup ──────────────────────────────────────────────────────────────────
// Restore or clean up relay state from previous run
const prevRelays = readJSON(RELAYS_PATH, []);
if (prevRelays.length > 0) {
  let restored = 0;
  let cleared  = 0;
  for (const r of prevRelays) {
    let alive = false;
    if (r.pid) {
      try { process.kill(r.pid, 0); alive = true; } catch {}
    }
    if (alive) {
      // Process still running — restore state (no proc handle, use pid for kill)
      relays.set(r.slot, { ...r, proc: null });
      restored++;
    } else {
      cleared++;
    }
  }
  if (restored > 0) console.log(`[Relay] Restored ${restored} active relay(s) from previous session`);
  if (cleared  > 0) console.log(`[Relay] Cleared ${cleared} stale relay(s) from previous session`);
  writeJSON(RELAYS_PATH, getRelayStates());
}

schedules.forEach(registerSchedule);
startAutoSchedCron();
startM3URefreshCron();

// ─── Start ────────────────────────────────────────────────────────────────────
const server = require('http').createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Stream Scheduler running at http://0.0.0.0:${PORT}`);
  console.log(`  Open http://localhost:${PORT} in your browser\n`);
  logAutoActivity('info', 'Service started');
});
