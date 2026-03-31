const fs = require('fs');
let code = fs.readFileSync('./server.js', 'utf8');

// 1. Add espn-scheduler require
code = code.replace(
  '// ── Auto-Scheduler ────────────────────────────────────────────────────────────',
  '// ── Auto-Scheduler ────────────────────────────────────────────────────────────\nconst { runAutoScheduler } = require(\'./src/espn-scheduler\');'
);

// 2. Remove runAutoScheduler function body
const startStr = 'async function runAutoScheduler() {';
const endStr = 'function startAutoSchedCron() {';
const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);
if (startIndex !== -1 && endIndex !== -1) {
  code = code.slice(0, startIndex) + code.slice(endIndex);
}

// 3. Update startAutoSchedCron schedule call
code = code.replace(
  'autoSchedCronJob = cron.schedule(`${parseInt(m)} ${parseInt(h)} * * *`, runAutoScheduler, { timezone: \'America/New_York\' });',
  'autoSchedCronJob = cron.schedule(`${parseInt(m)} ${parseInt(h)} * * *`, () => {\n    runAutoScheduler({ autoScheduler, m3uMemCache, schedules, saveSchedules, registerSchedule, logAutoActivity, refreshM3U });\n  }, { timezone: \'America/New_York\' });'
);

// 4. Update /api/auto-scheduler/run endpoint call
code = code.replace(
  'try { await runAutoScheduler(); } catch (e) { logAutoActivity(\'error\', \'Auto-scheduler run failed: \' + e.message); }',
  'try { await runAutoScheduler({ autoScheduler, m3uMemCache, schedules, saveSchedules, registerSchedule, logAutoActivity, refreshM3U }); } catch (e) { logAutoActivity(\'error\', \'Auto-scheduler run failed: \' + e.message); }'
);

fs.writeFileSync('./server.js', code);
console.log("Refactoring complete.");
