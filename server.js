#!/usr/bin/env node
'use strict';

const express      = require('express');
const { OBSWebSocket } = require('obs-websocket-js');
const { WebSocketServer } = require('ws');
const session      = require('express-session');
const bcrypt       = require('bcryptjs');
const path         = require('path');
const fs           = require('fs');
const cron         = require('node-cron');
const { spawn } = require('child_process');
const axios        = require('axios');
const { v4: uuidv4 } = require('uuid');

// ─── Config ───────────────────────────────────────────────────────────────────
const DATA_DIR     = path.join(__dirname, 'data');
const CONFIG_PATH  = path.join(DATA_DIR, 'config.json');
const SCHED_PATH   = path.join(DATA_DIR, 'schedules.json');
const HISTORY_PATH     = path.join(DATA_DIR, 'history.json');
const NOW_PLAYING_PATH = path.join(DATA_DIR, 'now_playing.json');
const SETTINGS_PATH= path.join(DATA_DIR, 'settings.json');
const AUTO_SCHED_PATH = path.join(DATA_DIR, 'auto_scheduler.json');

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('✗  config.json not found. Run  node setup.js  first.');
  process.exit(1);
}

const config   = JSON.parse(fs.readFileSync(CONFIG_PATH));
const PORT     = config.port || 3000;

// ─── Persistence helpers ──────────────────────────────────────────────────────
const readJSON  = (p, def) => { try { return JSON.parse(fs.readFileSync(p)); } catch { return def; } };
const writeJSON = (p, d)   => fs.writeFileSync(p, JSON.stringify(d, null, 2));

let schedules     = readJSON(SCHED_PATH, []);
let nowPlaying    = readJSON(NOW_PLAYING_PATH, null); // { name, url, startedAt }
let autoScheduler = readJSON(AUTO_SCHED_PATH, {
  enabled: false,
  searchString: 'Texas Tech',
  apiEndpoint: 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard',
  checkTime: '07:00',
  refreshBeforeRun: false,
  activityLog: []
});
const MAX_HISTORY = 10;
let history   = readJSON(HISTORY_PATH, []).slice(-MAX_HISTORY); // enforce limit on load
let settings  = readJSON(SETTINGS_PATH, { m3uAutoRefresh: false, m3uRefreshTime: '06:00' });

const saveSchedules = () => { writeJSON(SCHED_PATH, schedules); pushDashboardEvent('schedule'); };
const saveHistory    = () => { history = history.slice(-MAX_HISTORY); writeJSON(HISTORY_PATH, history); pushDashboardEvent('history'); };
const saveNowPlaying = () => writeJSON(NOW_PLAYING_PATH, nowPlaying);
const saveSettings    = () => writeJSON(SETTINGS_PATH, settings);
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
  secret: config.sessionSecret || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 90 * 24 * 60 * 60 * 1000 }  // 90 days
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
  // The /c timeout command waits 2 seconds before issuing the restart
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
    // Persist updated hash back to config.json
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
  settings = { ...settings, ...req.body };
  saveSettings();
  startM3URefreshCron();
  res.json(settings);
});

// ── Schedules ─────────────────────────────────────────────────────────────────
app.get('/api/schedules', (req, res) => res.json(schedules));

app.post('/api/schedules', (req, res) => {
  const s = {
    id:          uuidv4(),
    name:        req.body.name        || 'Untitled',
    url:         req.body.url,
    logo:        req.body.logo || (m3uMemCache?.channels || []).find(c => c.url === req.body.url)?.logo || null,
    scheduleType: req.body.scheduleType || 'once',   // once | cron
    runAt:       req.body.runAt  || null,            // ISO string for once
    cronExpr:    req.body.cronExpr || null,          // cron string for recurring
    enabled:     true,
    createdAt:   new Date().toISOString(),
    lastRun:     null,
    nextRun:     null
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
  const s = { id: null, name: name || 'Now', url, noHistory, logo: resolvedLogo };
  const result = await launchPlayer(s);
  res.json(result);
});


// ── History ────────────────────────────────────────────────────────────────────
app.get('/api/history', (req, res) => res.json(history.slice().reverse())); // newest first
app.delete('/api/history', (req, res) => { history = []; saveHistory(); res.json({ ok: true }); });

// ── M3U / Xtream ──────────────────────────────────────────────────────────────
const M3U_CACHE_PATH = path.join(DATA_DIR, 'm3u_cache.json');

// In-memory channel cache
let m3uMemCache = null; // { channels, fetchedAt, sourceUrl, byteSize }

// Load persisted cache from disk on startup
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

// Return metadata about the current cache (no channel data — keep it light)
app.get('/api/m3u/cache-info', (req, res) => {
  if (!m3uMemCache) return res.json({ exists: false });
  res.json({
    exists:     true,
    count:      m3uMemCache.channels.length,
    fetchedAt:  m3uMemCache.fetchedAt,
    sourceUrl:  m3uMemCache.sourceUrl,
    byteSize:   m3uMemCache.byteSize || 0
  });
});

// Load the persisted cache into the active search cache (no download needed)
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

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

  try {
    send({ type: 'start' });

    const resp = await axios.get(url, {
      timeout: 120000,
      responseType: 'stream',
    });

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

        // Update in-memory cache
        m3uMemCache = { channels, fetchedAt: Date.now(), sourceUrl: url, byteSize: received };

        // Persist to disk (write asynchronously so SSE isn't delayed)
        fs.writeFile(M3U_CACHE_PATH, JSON.stringify(m3uMemCache), (err) => {
          if (err) console.warn('Could not persist M3U cache:', err.message);
        });

        logAutoActivity('info', `M3U refreshed manually — ${channels.length} channels loaded.`);
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

// Search — works against the in-memory cache regardless of source (download or disk)
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
      if (!meta.name && nameMatch) meta.name = nameMatch[1].trim(); // fallback

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
        launchPlayer(s);
        // delete after firing — one-time schedules don't linger
        const idx = schedules.findIndex(x => x.id === s.id);
        if (idx !== -1) { schedules.splice(idx, 1); saveSchedules(); }
        cronJobs.delete(s.id);
      }, delay);
      cronJobs.set(s.id, { type: 'timeout', handle: timer });
      // update nextRun
      const idx = schedules.findIndex(x => x.id === s.id);
      if (idx !== -1) { schedules[idx].nextRun = runTime.toISOString(); saveSchedules(); }
    }
  } else if (s.scheduleType === 'cron' && s.cronExpr) {
    if (!cron.validate(s.cronExpr)) return;
    const job = cron.schedule(s.cronExpr, () => launchPlayer(s));
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

async function ensureOBSStreaming() {
  try {
    await withOBS(async obs => {
      const { outputActive } = await obs.call('GetStreamStatus');
      if (!outputActive) {
        console.log('[OBS] Not streaming — starting stream...');
        await obs.call('StartStream');
        await new Promise(r => setTimeout(r, 3000));
        console.log('[OBS] Stream started.');
      }
    });
  } catch (e) {
    console.log('[OBS] Could not connect to OBS WebSocket:', e.message);
  }
}

// Returns { activeName, inactiveName } for the currently configured OBS source type
function obsSourceNames() {
  const isVLC = (settings.obsSourceType || 'media') === 'vlc';
  return { activeName: isVLC ? 'VLC Video' : 'Media', inactiveName: isVLC ? 'Media' : 'VLC Video' };
}

// #11 — shared OBS source setter (supports Media and VLC Video source types)
async function setOBSMediaSource(obs, url) {
  const { activeName, inactiveName } = obsSourceNames();
  const isVLC = activeName === 'VLC Video';

  await obs.call('SetInputSettings', {
    inputName:     activeName,
    inputSettings: isVLC
      ? { playlist: [{ value: url, hidden: false, selected: false }] }
      : { input: url, is_local_file: false, looping: false }
  });

  // Show active source, hide inactive source in the current scene
  try {
    const { currentProgramSceneName } = await obs.call('GetCurrentProgramScene');
    const { sceneItems }              = await obs.call('GetSceneItemList', { sceneName: currentProgramSceneName });
    for (const item of sceneItems) {
      if (item.sourceName === activeName || item.sourceName === inactiveName) {
        await obs.call('SetSceneItemEnabled', {
          sceneName:        currentProgramSceneName,
          sceneItemId:      item.sceneItemId,
          sceneItemEnabled: item.sourceName === activeName
        });
      }
    }
  } catch (e) {
    console.warn('[OBS] Could not control source visibility:', e.message);
  }
}

async function launchPlayer(s) {
  if (nowPlaying?.url === s.url && !nowPlaying?.stopped) {
    // Real-time check: only skip if OBS is actually streaming
    try {
      const { outputActive } = await withOBS(obs => obs.call('GetStreamStatus'));
      if (outputActive) return { ok: true }; // genuinely streaming this URL, skip
      // OBS not streaming — fall through to re-launch
    } catch {
      return { ok: false, error: 'Cannot connect to OBS' };
    }
  }
  // Clear stopped flag before launch so the race guard below only catches stops
  // that happen *during* this launch, not stops from a previous session
  if (nowPlaying?.stopped) { nowPlaying.stopped = false; }
  const entry = {
    id:           uuidv4(),
    scheduleId:   s.id,
    scheduleName: s.name,
    url:          s.url,
    logo:         s.logo || null,
    player:       'OBS',
    startedAt:    new Date().toISOString(),
    status:       'launched'
  };

  const logEntry = () => {
    if (!s.noHistory) {
      const latest = history[history.length - 1];
      if (!latest || latest.url !== s.url) {
        history.push(entry);
        saveHistory(); // saveHistory() enforces MAX_HISTORY cap
      }
    }
    const idx = schedules.findIndex(x => x.id === s.id);
    if (idx !== -1) { schedules[idx].lastRun = entry.startedAt; saveSchedules(); }
  };

  try {
    await ensureOBSStreaming();
    await withOBS(obs => setOBSMediaSource(obs, s.url));
    logEntry();
    // Only skip if THIS specific stream was stopped mid-launch (race condition guard)
    if (!(nowPlaying?.url === s.url && nowPlaying?.stopped)) {
      nowPlaying = { name: s.name, url: s.url, logo: s.logo || null, startedAt: entry.startedAt };
      saveNowPlaying();
      pushDashboardEvent('nowplaying', { nowPlaying });
    }
    console.log('[OBS] Source updated:', s.url);
    return { ok: true };
  } catch (e) {
    console.error('[OBS] Failed to update media source:', e.message);
    return { ok: false, error: 'Cannot connect to OBS' };
  }
}

// Boot: re-register all enabled schedules

// ── Auto-Scheduler ────────────────────────────────────────────────────────────
let autoSchedCronJob = null;
const autoSchedSSEClients = new Set();
const dashboardSSEClients = new Set();

// #9 — shared SSE broadcaster
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
    logAutoActivity('error', 'Search string or API endpoint not configured.');
    return;
  }
  if (!m3uMemCache || !m3uMemCache.sourceUrl) {
    logAutoActivity('error', 'M3U cache not loaded. Please load M3U manually first.');
    return;
  }

  if (autoScheduler.refreshBeforeRun) {
    try {
      logAutoActivity('info', 'Refreshing M3U…');
      const count = await refreshM3U();
      logAutoActivity('info', `M3U refreshed — ${count} channels loaded.`);
    } catch (e) {
      logAutoActivity('error', `M3U refresh failed: ${e.message}`);
      return;
    }
  }

  // Today's date in Eastern Time (handles EST/EDT)
  const now = new Date();
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const yyyy = etDate.getFullYear();
  const mm   = String(etDate.getMonth() + 1).padStart(2, '0');
  const dd   = String(etDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const friendlyDate = `${monthNames[etDate.getMonth()]} ${etDate.getDate()}`;

  // Fetch scoreboard
  let events;
  try {
    const resp = await axios.get(`${apiEndpoint}?dates=${dateStr}`, { timeout: 10000 });
    events = resp.data.events || [];
  } catch (e) {
    logAutoActivity('error', `API error: ${e.message}`);
    return;
  }

  // Find games matching search string
  const matches = events.filter(ev => {
    const competitors = ev.competitions?.[0]?.competitors || [];
    return competitors.some(c =>
      c.team?.displayName?.toLowerCase().includes(searchString.toLowerCase()) ||
      c.team?.location?.toLowerCase().includes(searchString.toLowerCase())
    );
  });

  if (matches.length === 0) {
    logAutoActivity('info', `No ${searchString} games found today (${friendlyDate}).`);
    return;
  }

  for (const ev of matches) {
    const gameName = ev.name;

    // Convert game time UTC → Eastern, add 10 min offset
    const gameUtc  = new Date(ev.date);
    const gameEt   = new Date(gameUtc.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    gameEt.setMinutes(gameEt.getMinutes() + 10);
    const hh   = String(gameEt.getHours()).padStart(2, '0');
    const min  = String(gameEt.getMinutes()).padStart(2, '0');
    const runAt = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

    // Search M3U cache for matching channel
    const channels = m3uMemCache.channels || [];
    const search   = searchString.toLowerCase();
    const dateLow  = friendlyDate.toLowerCase();

    // Get opponent team name from ESPN for better matching
    const competitors = ev.competitions?.[0]?.competitors || [];
    const opponent = competitors
      .find(c => !c.team?.displayName?.toLowerCase().includes(searchString.toLowerCase()) &&
                 !c.team?.location?.toLowerCase().includes(searchString.toLowerCase()))
      ?.team?.location?.toLowerCase() || null;

    let matching = channels.filter(ch => {
      const name = (ch.name || '').toLowerCase();
      return name.includes(search) && name.includes(dateLow);
    });

    // If multiple matches, narrow by opponent name
    if (matching.length > 1 && opponent) {
      const byOpponent = matching.filter(ch => {
        const name = (ch.name || '').toLowerCase();
        return name.includes(opponent);
      });
      if (byOpponent.length > 0) matching = byOpponent;
    }

    if (matching.length === 0) {
      logAutoActivity('warn', `Found ${gameName} but no M3U channel matched ${searchString} on ${friendlyDate}.`);
      continue;
    }

    const ch = matching[0];

    // Use M3U eventTime if available — more reliable than ESPN API time
    let schedHH = hh, schedMin = min, schedRunAt = runAt;
    if (ch.eventTime) {
      const [datePart, timePart] = ch.eventTime.split('T');
      const [evHH, evMM] = timePart.split(':').map(Number);
      const evWithOffset = evMM + 10;
      schedHH  = String(evHH + Math.floor(evWithOffset / 60)).padStart(2, '0');
      schedMin = String(evWithOffset % 60).padStart(2, '0');
      schedRunAt = `${datePart}T${schedHH}:${schedMin}`;
    }

    // Duplicate prevention
    const isDuplicate = schedules.some(s =>
      s.url === ch.url && s.runAt && s.runAt.startsWith(`${yyyy}-${mm}-${dd}`)
    );
    if (isDuplicate) {
      logAutoActivity('info', `${gameName} already scheduled — skipping.`);
      continue;
    }

    // Create schedule
    const s = {
      id:           uuidv4(),
      name:         ch.name,
      url:          ch.url,
      logo:         ch.logo || null,
      scheduleType: 'once',
      runAt:        schedRunAt,
      enabled:      true,
      createdAt:    new Date().toISOString(),
      lastRun:      null
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
    try {
      const count = await refreshM3U();
      console.log(`[M3U] Daily refresh complete — ${count} channels.`);
      logAutoActivity('info', `M3U auto-refreshed — ${count} channels loaded.`);
    } catch (e) {
      console.warn('[M3U] Daily refresh failed:', e.message);
      logAutoActivity('error', `M3U auto-refresh failed: ${e.message}`);
    }
  });
  console.log(`[M3U] Auto-refresh cron set for ${settings.m3uRefreshTime} daily`);
}

// #8 — SSE endpoint factory
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

app.get('/api/auto-scheduler',       (req, res) => res.json(autoScheduler));
app.put('/api/auto-scheduler', (req, res) => {
  autoScheduler = { ...autoScheduler, ...req.body, activityLog: autoScheduler.activityLog };
  saveAutoScheduler();
  // If cron is already running, restart it with the new settings
  if (autoSchedCronJob) startAutoSchedCron();
  res.json(autoScheduler);
});

// Toggle enable/disable — this is what actually starts/stops the cron
app.post('/api/auto-scheduler/enable', (req, res) => {
  autoScheduler.enabled = true;
  saveAutoScheduler();
  startAutoSchedCron();
  res.json({ ok: true, enabled: true });
});

app.post('/api/auto-scheduler/disable', (req, res) => {
  autoScheduler.enabled = false;
  saveAutoScheduler();
  startAutoSchedCron(); // will stop cron since enabled is false
  res.json({ ok: true, enabled: false });
});
app.post('/api/auto-scheduler/run',  async (req, res) => { res.json({ ok: true }); await runAutoScheduler(); });

schedules.forEach(registerSchedule);
startAutoSchedCron();
startM3URefreshCron();

// ── OBS WebSocket ─────────────────────────────────────────────────────────────
const OBS_PORT = 4455;

async function withOBS(fn) {
  const obs = new OBSWebSocket();
  await obs.connect(`ws://localhost:${OBS_PORT}`);
  try { return await fn(obs); } finally { obs.disconnect(); }
}

app.get('/api/obs/rtmp-url', async (req, res) => {
  try {
    const url = await withOBS(async obs => {
      const { streamServiceSettings } = await obs.call('GetStreamServiceSettings');
      const { server, key } = streamServiceSettings;
      if (!server || !key) return null;
      return `${server.replace(/\/$/, '')}/${key}`;
    });
    res.json({ url });
  } catch (e) {
    res.json({ url: null });
  }
});

app.get('/api/obs/status', async (req, res) => {
  try {
    const { outputActive } = await withOBS(obs => obs.call('GetStreamStatus'));
    const np = nowPlaying || (history.length > 0 ? {
      name:      history[history.length - 1].scheduleName,
      url:       history[history.length - 1].url,
      logo:      history[history.length - 1].logo || null,
      startedAt: history[history.length - 1].startedAt,
    } : null);
    res.json({ ok: true, streaming: outputActive, nowPlaying: np });
  } catch (e) {
    res.json({ ok: false, streaming: false, error: e.message });
  }
});

app.post('/api/obs/stream/start', async (req, res) => {
  try {
    await withOBS(async obs => {
      const lastHistory = history.length > 0 ? history[history.length - 1] : null;
      const url  = (nowPlaying && nowPlaying.url)  || (lastHistory ? lastHistory.url  : null);
      const name = (nowPlaying && nowPlaying.name) || (lastHistory ? lastHistory.scheduleName : 'Unknown');
      if (url) {
        await setOBSMediaSource(obs, url);
        const logo = (m3uMemCache?.channels || []).find(c => c.url === url)?.logo || null;
        if (nowPlaying?.url !== url) {
          const entry = { id: uuidv4(), scheduleId: null, scheduleName: name, url, logo, player: 'OBS', startedAt: new Date().toISOString(), status: 'launched' };
          history.push(entry);
          saveHistory(); // saveHistory() enforces MAX_HISTORY cap
          nowPlaying = { name, url, logo, startedAt: entry.startedAt };
          saveNowPlaying();
        }
      }
      const { outputActive } = await obs.call('GetStreamStatus');
      if (!outputActive) await obs.call('StartStream');
    });
    pushDashboardEvent('nowplaying', { nowPlaying });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/obs/stream/stop', async (req, res) => {
  try {
    await withOBS(async obs => {
      await obs.call('StopStream');
      const { activeName } = obsSourceNames();
      const isVLC = activeName === 'VLC Video';
      await obs.call('TriggerMediaInputAction', {
        inputName:   activeName,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
      });
      await obs.call('SetInputSettings', {
        inputName:     activeName,
        inputSettings: isVLC ? { playlist: [] } : { input: '', is_local_file: false, looping: false }
      });
    });
    // Keep nowPlaying data but mark as stopped so Start knows the URL
    if (nowPlaying) { nowPlaying.stopped = true; saveNowPlaying(); }
    pushDashboardEvent('history');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ── Stream Preview (WebSocket — per-client FFmpeg) ────────────────────────────
const FFMPEG  = path.join(__dirname, 'bin', 'ffmpeg.exe');

let   previewClients = new Set();

function spawnFFmpegForClient(ws) {
  const rtmpUrl = settings.rtmpUrl;
  if (!rtmpUrl) { ws.close(1008, 'No RTMP URL configured'); return null; }
  const args = [
    '-i', rtmpUrl,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration', '500000',
    'pipe:1'
  ];
  let proc;
  try { proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch(e) { console.error('[Preview] Failed to spawn FFmpeg:', e.message); return null; }

  proc.stdout.on('data', chunk => {
    try { if (ws.readyState === 1) ws.send(chunk); }
    catch(e) { proc.kill('SIGKILL'); }
  });
  proc.stderr.on('data', d => {
    const line = d.toString().split('\n').find(l => /error|rtmp|failed/i.test(l));
    if (line) console.log('[FFmpeg preview]', line.trim());
  });
  proc.on('error', e => console.error('[Preview] FFmpeg error:', e.message));
  proc.on('exit', code => { ws.ffmpegProc = null; console.log('[Preview] FFmpeg exited, code:', code); });
  return proc;
}

app.get('/api/preview/status', (req, res) => { res.json({ running: previewClients.size > 0 }); });

// Catch-all: serve index.html for any unmatched route (enables History API navigation)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
const server = require('http').createServer(app);

// WebSocket server for MPEG-TS preview stream
const wss = new WebSocketServer({ server, path: '/ws/preview' });
wss.on('connection', ws => {
  ws.ffmpegProc = null;
  previewClients.add(ws);
  console.log('[Preview] Client connected, total:', previewClients.size);

  ws.on('message', msg => {
    if (msg.toString() === 'start') {
      if (!ws.ffmpegProc) {
        ws.ffmpegProc = spawnFFmpegForClient(ws);
      }
    } else if (msg.toString() === 'stop') {
      if (ws.ffmpegProc) { ws.ffmpegProc.kill('SIGKILL'); ws.ffmpegProc = null; }
    }
  });

  ws.on('close', () => {
    if (ws.ffmpegProc) { ws.ffmpegProc.kill('SIGKILL'); ws.ffmpegProc = null; }
    previewClients.delete(ws);
    console.log('[Preview] Client disconnected, total:', previewClients.size);
  });
});


server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Stream Scheduler running at http://0.0.0.0:${PORT}`);
  console.log(`  Open http://localhost:${PORT} in your browser\n`);
  logAutoActivity('info', 'Service started.');
});
