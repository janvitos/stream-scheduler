const { v4: uuidv4 } = require('uuid');

async function runAutoScheduler(context) {
  const {
    autoScheduler,
    m3uMemCache,
    schedules,
    saveSchedules,
    registerSchedule,
    logAutoActivity,
    refreshM3U,
    timezone
  } = context;

  logAutoActivity('info', 'Running daily check…');
  const { searchString, apiEndpoint, startOffset = 10 } = autoScheduler;

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
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const yyyy   = etDate.getFullYear();
  const mm     = String(etDate.getMonth() + 1).padStart(2, '0');
  const dd     = String(etDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const friendlyDate = `${monthNames[etDate.getMonth()]} ${String(etDate.getDate()).padStart(2, '0')}`;

  let events;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${apiEndpoint}?dates=${dateStr}`, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
    
    const data = await resp.json();
    events = data.events || [];
  } catch (e) {
    logAutoActivity('error', `API error: ${e.name === 'AbortError' ? 'Request timed out' : e.message}`);
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
    const gameEt  = new Date(gameUtc.toLocaleString('en-US', { timeZone: timezone }));
    
    // Extract game time WITHOUT offset for matching
    const gameHh  = String(gameEt.getHours()).padStart(2, '0');
    const gameMin = String(gameEt.getMinutes()).padStart(2, '0');
    const timePattern = `${gameHh}:${gameMin}`;
    
    // Add offset for scheduling
    gameEt.setMinutes(gameEt.getMinutes() + startOffset);
    const hh  = String(gameEt.getHours()).padStart(2, '0');
    const min = String(gameEt.getMinutes()).padStart(2, '0');
    const runAt = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

    if (gameEt <= now) {
      logAutoActivity('warn', `${gameName} already started — skipping`);
      continue;
    }

    const channels = m3uMemCache.channels || [];
    const search   = searchString.toLowerCase();
    const dateLow  = friendlyDate.toLowerCase();

    const competitors = ev.competitions?.[0]?.competitors || [];
    const opponentTeam = competitors
      .find(c => {
        const t = c.team || {};
        return ![t.displayName, t.location, t.shortDisplayName, t.name]
          .filter(Boolean)
          .some(n => n.toLowerCase().includes(search));
      })?.team || null;
    const opponentBaseNames = opponentTeam
      ? [opponentTeam.displayName, opponentTeam.location, opponentTeam.shortDisplayName, opponentTeam.name]
          .filter(Boolean).map(n => n.toLowerCase())
      : [];

    // Add word-prefix variants from displayName so e.g. "Abilene Christian Wildcats"
    // also matches channels that only include "Abilene Christian" (without the mascot).
    const opponentPrefixes = [];
    if (opponentTeam?.displayName) {
      const words = opponentTeam.displayName.toLowerCase().trim().split(/\s+/);
      for (let len = 2; len < words.length; len++) {
        opponentPrefixes.push(words.slice(0, len).join(' '));
      }
    }

    // Also extract opponent name directly from ev.name (e.g. "Incarnate Word Cardinals at Texas Tech
    // Red Raiders") — ESPN team objects sometimes use abbreviations like "UIW" while the game name
    // always contains the full school name. Generate all word-length prefixes of that name too.
    const gameNamePrefixes = [];
    const gameNameLower = (gameName || '').toLowerCase();
    const nameSep = gameNameLower.match(/^(.+?)\s+(?:at|vs\.?)\s+(.+)$/);
    if (nameSep) {
      const [, teamA, teamB] = nameSep;
      const opFromName = teamA.includes(search) ? teamB.trim()
                       : teamB.includes(search) ? teamA.trim()
                       : null;
      if (opFromName) {
        const words = opFromName.split(/\s+/);
        for (let len = 2; len <= words.length; len++) {
          gameNamePrefixes.push(words.slice(0, len).join(' '));
        }
      }
    }

    const opponentNames = [...new Set([...opponentBaseNames, ...opponentPrefixes, ...gameNamePrefixes])];

    let matching = channels.filter(ch => {
      const name = ch.searchName || (ch.name || '').toLowerCase();
      const hasSearch = name.includes(search);
      const hasOpponent = opponentNames.length === 0 || opponentNames.some(n => name.includes(n));
      if (!hasSearch || !hasOpponent) return false;
      return true;
    });

    if (matching.length > 1) {
      const byOpponent = matching.filter(ch => {
        const name = ch.searchName || (ch.name || '').toLowerCase();
        return opponentNames.some(n => name.includes(n));
      });
      if (byOpponent.length > 0) matching = byOpponent;
      
      // Filter by time to distinguish doubleheaders (same teams, different times)
       if (matching.length > 1) {
         matching = matching.filter(ch => 
           (ch.searchName || (ch.name || '').toLowerCase()).includes(timePattern.toLowerCase())
         );
       }
    }

    if (matching.length === 0) {
      logAutoActivity('warn', `Found ${gameName} but no M3U channel matched ${searchString} on ${friendlyDate}`);
      continue;
    }

    const ch = matching[0];

    const schedRunAt = runAt;

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
    const h24 = parseInt(hh, 10);
    const fmtTime = `${h24 % 12 || 12}:${min} ${h24 >= 12 ? 'PM' : 'AM'}`;
    logAutoActivity('success', `Scheduled ${gameName} at ${fmtTime} (+${startOffset} min)`);
  }
}

module.exports = { runAutoScheduler };
