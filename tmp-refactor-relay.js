const fs = require('fs');
let code = fs.readFileSync('./server.js', 'utf8');

// 1. Add relay-engine setup
code = code.replace(
  'const relays = new Map();',
  `const relays = new Map();
const createRelayEngine = require('./src/relay-engine');
const { killRelay, launchStream, spawnRelay } = createRelayEngine({
  getSettings: () => settings,
  ALL_SLOTS,
  relays,
  FFMPEG_PATH,
  saveRelays,
  logAutoActivity,
  getHistory: () => history,
  saveHistory,
  schedules,
  saveSchedules,
  serverLog
});`
);

// 2. Remove relay engine function bodies
const startStr = '// ─── Relay engine ─────────────────────────────────────────────────────────────';
const endStr = '// ── Auto-Scheduler ────────────────────────────────────────────────────────────';
const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);
if (startIndex !== -1 && endIndex !== -1) {
  code = code.slice(0, startIndex) + "\n" + code.slice(endIndex);
}

fs.writeFileSync('./server.js', code);
console.log("Relay Engine refactoring complete.");
