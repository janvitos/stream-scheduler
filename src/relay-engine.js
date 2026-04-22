const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const RECONNECT_BASE_DELAY = 10000;
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MAX_RETRIES = 10;
const RECONNECT_STABLE_THRESHOLD = 60000;

function createRelayEngine(context) {
  const {
    getSettings,
    ALL_SLOTS,
    relays,
    FFMPEG_PATH,
    saveRelays,
    logAutoActivity,
    getHistory,
    saveHistory,
    schedules,
    saveSchedules,
    serverLog
  } = context;

  const launching = new Set();
  const retryState = new Map();

  function findFreeSlot(preferred) {
    const settings = getSettings();
    const max = Math.max(1, Math.min(5, settings.maxSlots || 2));
    if (preferred && ALL_SLOTS.includes(preferred) && ALL_SLOTS.indexOf(preferred) < max && !relays.has(preferred)) {
      return preferred;
    }
    for (let i = 0; i < max; i++) {
      if (!relays.has(ALL_SLOTS[i])) return ALL_SLOTS[i];
    }
    return null;
  }

  function spawnRelay(slot, s) {
    const settings = getSettings();
    const srtUrl = settings.srtUrl || '127.0.0.1';
    const srtPort = settings.srtPort || 8890;
    const srtLatency = settings.srtLatency || 120;
    const srtPassword = settings.srtPassword ? `&passphrase=${encodeURIComponent(settings.srtPassword)}` : '';
    const streamId = `publish:${slot}`;
    const outputUrl = `srt://${srtUrl}:${srtPort}?mode=caller&latency=${srtLatency}&streamid=${encodeURIComponent(streamId)}${srtPassword}`;
    const args = [
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '7',
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-rw_timeout', '30000000',
      '-probesize', '5000000',
      '-analyzeduration', '5000000',
      '-i', s.url,
      '-map', '0:v', '-map', '0:a:0',
      '-c:v', 'copy',
      '-bsf:v', 'h264_mp4toannexb',
      '-c:a', 'aac', '-ac', '2', '-b:a', '128k',
      '-copyts',
      '-muxdelay', '0',
      '-f', 'mpegts',
      outputUrl
    ];

    let stderrTarget = 'ignore';
    if (settings.debugLogging) {
      try {
        const logDir  = settings.ffmpegLogPath || path.join(process.cwd(), 'logs');
        const maxBytes = (settings.ffmpegLogMaxSizeMb || 10) * 1024 * 1024;
        fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, `ffmpeg-${slot}.log`);
        try { if (fs.statSync(logFile).size >= maxBytes) fs.writeFileSync(logFile, ''); } catch {}
        stderrTarget = fs.openSync(logFile, 'a');
      } catch (err) {
        logAutoActivity('warn', `Could not open FFmpeg log for ${slot}: ${err.message}`);
      }
    }

    let proc;
    try {
      proc = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'ignore', stderrTarget], detached: true });
      proc.unref();
    } catch (e) {
      if (typeof stderrTarget === 'number') try { fs.closeSync(stderrTarget); } catch {}
      console.error(`[Relay] Failed to spawn FFmpeg for ${slot}:`, e.message);
      return null;
    }

    if (typeof stderrTarget === 'number') fs.closeSync(stderrTarget);

    proc.stdin?.on('error', () => {});

    proc.on('error', e => console.error(`[Relay:${slot}] FFmpeg error:`, e.message));

    proc.on('exit', (code) => {
      serverLog(`[Relay:${slot}] FFmpeg exited, code: ${code}`);
      const unexpected = relays.has(slot);
      const saved = unexpected ? { ...relays.get(slot), proc: undefined } : null;

      if (code === null) {
        logAutoActivity('warn',  `Relay ${slot} was stopped`);
      } else if (code === 0) {
        logAutoActivity('warn',  `Relay ${slot} ended unexpectedly (exit code 0)`);
      } else {
        logAutoActivity('error', `Relay ${slot} crashed (exit code ${code})`);
      }
      if (relays.has(slot)) {
        relays.delete(slot);
        saveRelays();
      }
      if (unexpected && saved && code !== null) {
        const rs = retryState.get(slot) || { count: 0, lastStartedAt: null };
        if (rs.lastStartedAt) {
          const uptime = Date.now() - new Date(rs.lastStartedAt).getTime();
          if (uptime >= RECONNECT_STABLE_THRESHOLD) {
            rs.count = 0;
          }
        }
        rs.count++;
        if (rs.count > RECONNECT_MAX_RETRIES) {
          logAutoActivity('error', `Relay ${slot} exceeded max retries (${RECONNECT_MAX_RETRIES}), giving up`);
          retryState.delete(slot);
          return;
        }
        const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, rs.count - 1), RECONNECT_MAX_DELAY);
        rs.lastStartedAt = null;
        retryState.set(slot, rs);
        logAutoActivity('info', `Auto-restarting relay ${slot} in ${Math.round(delay / 1000)}s (attempt ${rs.count}/${RECONNECT_MAX_RETRIES})…`);
        setTimeout(() => {
          const newProc = spawnRelay(slot, saved);
          if (newProc) {
            const startedAt = new Date().toISOString();
            relays.set(slot, { slot, name: saved.name, url: saved.url, logo: saved.logo, startedAt, pid: newProc.pid, proc: newProc });
            const upd = retryState.get(slot);
            if (upd) upd.lastStartedAt = startedAt;
            saveRelays();
            logAutoActivity('info', `Relay ${slot} auto-restarted (attempt ${rs.count})`);
          } else {
            logAutoActivity('error', `Relay ${slot} failed to auto-restart`);
          }
        }, delay);
      }
    });

    return proc;
  }

  function killRelay(slot) {
    const relay = relays.get(slot);
    if (!relay) return false;
    const pid = relay.pid;
    const proc = relay.proc;
    if (proc && proc.stdin && proc.stdin.writable) {
      try { proc.stdin.write('q'); } catch {}
    } else if (pid) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    const forceTimer = setTimeout(() => {
      try { process.kill(pid, 0); } catch { return; }
      if (proc) { try { proc.kill('SIGKILL'); } catch {} }
      else { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }, 5000);
    forceTimer.unref();
    relays.delete(slot);
    retryState.delete(slot);
    saveRelays();
    return true;
  }

  async function launchStream(s) {
    const settings = getSettings();
    let slot = findFreeSlot(s.preferredSlot);
    if (!slot) {
      const max = Math.max(1, Math.min(5, settings.maxSlots || 2));
      const preferred = s.preferredSlot && ALL_SLOTS.includes(s.preferredSlot) && ALL_SLOTS.indexOf(s.preferredSlot) < max
        ? s.preferredSlot
        : ALL_SLOTS[0];
      killRelay(preferred);
      slot = preferred;
    }

    if (launching.has(slot)) return { ok: false, error: `Slot ${slot} is already being launched` };
    launching.add(slot);

    const proc = spawnRelay(slot, s);
    if (!proc) { launching.delete(slot); return { ok: false, error: 'Failed to spawn FFmpeg' }; }

    const startedAt = new Date().toISOString();
    relays.set(slot, { slot, name: s.name, url: s.url, logo: s.logo || null, startedAt, pid: proc.pid, proc });
    retryState.set(slot, { count: 0, lastStartedAt: startedAt });
    launching.delete(slot);
    saveRelays();

    // Log history after relay is confirmed started
    if (!s.noHistory) {
      const history = getHistory();
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

    serverLog(`[Relay] Spawned ${slot} for ${s.url}`);
    return { ok: true, slot };
  }

  return { findFreeSlot, spawnRelay, killRelay, launchStream };
}

module.exports = createRelayEngine;
