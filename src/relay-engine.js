const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

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

  function findFreeSlot(preferred) {
    const settings = getSettings();
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
    const settings = getSettings();
    const outputUrl = `${settings.srsUrl.replace(/\/$/, '')}/${slot}`;
    const args = [
      ...(settings.debugLogging ? ['-loglevel', 'warning'] : []),
      '-re',
      '-fflags', '+genpts+discardcorrupt',
      '-reconnect', '1', '-reconnect_at_eof', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-rw_timeout', '5000000',
      '-i', s.url,
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '23',
      '-g', '60',
      '-c:a', 'aac', '-b:a', '128k',
      '-f', 'flv', '-flvflags', 'no_duration_filesize',
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
      proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', stderrTarget], detached: true });
      proc.unref();
    } catch (e) {
      if (typeof stderrTarget === 'number') try { fs.closeSync(stderrTarget); } catch {}
      console.error(`[Relay] Failed to spawn FFmpeg for ${slot}:`, e.message);
      return null;
    }

    if (typeof stderrTarget === 'number') fs.closeSync(stderrTarget); // parent closes its fd; child keeps its own

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
        logAutoActivity('info', `Auto-restarting relay ${slot} in 3s…`);
        setTimeout(() => {
          const newProc = spawnRelay(slot, saved);
          if (newProc) {
            relays.set(slot, { slot, name: saved.name, url: saved.url, logo: saved.logo, startedAt: new Date().toISOString(), pid: newProc.pid, proc: newProc });
            saveRelays();
            logAutoActivity('info', `Relay ${slot} auto-restarted`);
          } else {
            logAutoActivity('error', `Relay ${slot} failed to auto-restart`);
          }
        }, 3000);
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

  async function launchStream(s) {
    const settings = getSettings();
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
