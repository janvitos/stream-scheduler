# CLINE.md - Stream Scheduler Project Documentation

## Project Overview

**StreamSched** is a self-hosted IPTV stream relay and scheduler application built with Node.js, Express, and vanilla JavaScript/HTML/CSS. It bridges M3U/Xtream Codes playlist sources to an SRS (Simple Realtime Server) instance via FFmpeg for multi-stream broadcasting.

### Key Capabilities
- **Multi-slot relaying** — Supports up to 5 simultaneous stream relay slots (`stream01`–`stream05`)
- **Auto-scheduler** — Automatically fetches sports events from ESPN API and schedules matching channels
- **M3U/Xtream parsing** — Fetches, caches, and searches IPTV channel lists
- **Real-time monitoring** — Server-Sent Events (SSE) for live dashboard updates and activity logging
- **Auto-recovery** — Detects FFmpeg crashes and auto-restarts relays
- **Session-based auth** — Bcrypt password hashing with secure file-store persistence

---

## Directory Structure

```
stream-scheduler/
├── server.js              # Main Express server (entry point)
├── setup.js               # Initial config generation script
├── bin/                   # FFmpeg binary directory (optional, can use system path)
│   └── ffmpeg.exe         # Windows FFmpeg (if provided locally)
├── data/                  # Persisted data directory (created at runtime)
│   ├── config.json       # Server config: port, username, password hash, session secret
│   ├── schedules.json    # All scheduled streams
│   ├── history.json      # Recent playback history (last 10 entries)
│   ├── settings.json     # Runtime settings (SRS URLs, max slots, M3U refresh)
│   ├── auto_scheduler.json # Auto-scheduler config + activity log
│   ├── m3u_cache.json    # Cached M3U channel list
│   ├── relays.json       # Active relay state (PIDs, start times, logos)
│   └── sessions.json     # Express session store
├── public/                # Frontend assets
│   ├── index.html        # Main HTML template (SINGLE FILE SPA)
│   ├── login.html        # Authentication page
│   ├── app.js            # All frontend JavaScript logic
│   ├── style.css         # CSS styles
│   ├── logo.svg          # Branding logo
│   └── fonts/             # Self-hosted Inter font files (woff2)
├── src/                   # Modular source engines
│   ├── relay-engine.js   # FFmpeg process management
│   ├── m3u-parser.js     # M3U playlist parser
│   └── auto-scheduler.js # Sports event fetching and scheduling
├── logs/                  # FFmpeg debug log files (when enabled)
├── LICENSE                # MIT License
├── package.json           # NPM dependencies
├── package-lock.json      # Dependency lock file
├── README.md              # User documentation
└── .git*                  # Git-related files
```

---

## Dependencies (package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^4.18.2 | Web framework |
| express-session | ^1.17.3 | Session management |
| bcryptjs | ^2.4.3 | Password hashing |
| node-cron | ^3.0.3 | Cron job scheduling |
| uuid | ^9.0.0 | UUID generation |

**External Dependencies:**
- FFmpeg (system binary or in `bin/`)
- SRS (Simple Realtime Server) for HLS/WebRTC streaming
- ESPN API (college baseball scoreboard endpoint)

---

## Backend Architecture

### Entry Point: `server.js`

The main server file orchestrates all functionality. Key sections in order:

#### 1. Configuration & Persistence Helpers
```javascript
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json'); // Required at startup

// Persistent state helpers with write locking to prevent race conditions
const readJSON = (p, def) => { /* reads and parses JSON */ };
const writeJSON = (p, d) => { /* writes JSON with promise-based locking */ };
```

#### 2. Import of Module Factories
```javascript
const createRelayEngine = require('./src/relay-engine');
const { killRelay, launchStream, spawnRelay } = createRelayEngine({...});
const parseM3U = require('./src/m3u-parser');
const { runAutoScheduler } = require('./src/auto-scheduler');
```

#### 3. Express App Initialization
- Middleware: JSON parsing, URL encoding, static files, session (with custom `FileStore`)
- Auth middleware: `requireAuth` redirects unauthenticated users to `/login` unless accessing `/api/*`

#### 4. REST API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve dashboard |
| GET | `/login` | Authentication page |
| POST | `/api/auth/login` | Login with username/password |
| POST | `/api/auth/logout` | Logout (destroy session) |
| POST | `/api/auth/change-password` | Change password (bcrypt hash to disk) |
| GET | `/api/ping` | Health check, returns boot ID |
| POST | `/api/system/restart` | Restart service (via NSSM if configured) |
| GET | `/api/settings` | Retrieve settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/schedules` | List all schedules |
| POST | `/api/schedules` | Create schedule |
| PUT | `/api/schedules/:id` | Edit schedule |
| DELETE | `/api/schedules/:id` | Delete schedule |
| POST | `/api/play-now` | Launch stream immediately |
| GET | `/api/history` | Playback history (newest first) |
| DELETE | `/api/history` | Clear history |
| GET | `/api/relays` | Active relays list |
| POST | `/api/relays/:slot/stop` | Stop a relay |
| GET | `/api/m3u/cache-info` | M3U cache status |
| POST | `/api/m3u/use-cache` | Load from cache (returns metadata) |
| GET | `/api/m3u/download?url=` | SSE stream download + parse endpoint |
| POST | `/api/m3u/search` | Search channels in cache |
| GET | `/api/events` | Dashboard SSE events |
| GET | `/api/auto-scheduler/events` | Activity log SSE events |
| GET | `/api/auto-scheduler` | Auto-scheduler config |
| PUT | `/api/auto-scheduler` | Update auto-scheduler |
| POST | `/api/auto-scheduler/enable` | Enable auto-scheduler |
| POST | `/api/auto-scheduler/disable` | Disable auto-scheduler |
| POST | `/api/auto-scheduler/run` | Manual run of auto-scheduler |

#### 5. Scheduler Engine (`registerSchedule` / `unregisterSchedule`)
- Maintains a `cronJobs` Map keyed by schedule ID
- One-time schedules: `setTimeout` until `runAt`, then deletes from schedules
- Recurring schedules: `node-cron` job registered with `buildCronFromFrequency()`

#### 6. Relay Engine Integration
- `relays` Map tracks active relays: `{ slot, name, url, logo, startedAt, pid, proc }`
- `launchStream(s)` finds free slot, spawns FFmpeg, logs history
- `killRelay(slot)` terminates relay (SIGKILL) and removes from Map

#### 7. FFmpeg Process Spawning
```javascript
spawn(FFMPEG_PATH, args, { detached: true, stdio: ['ignore', 'ignore', stderrFd] });
proc.unref(); // Allows Node process to exit while FFmpeg continues
```

**Key FFmpeg Args:**
- `-re`: Read input as live stream (critical for IPTV)
- `-fflags +genpts+discardcorrupt`: Handle corrupted segments
- `-reconnect 1` family: Auto-reconnect on stream interruption
- `-c:v libx264 -preset veryfast -tune zerolatency -crf 23`: H.264 encoding
- `-c:a aac -b:a 128k`: Audio codec
- `-f flv -flvflags no_duration_filesize`: RTMP push

#### 8. Auto-Recovery
When FFmpeg exits unexpectedly (`relays.has(slot)` still true):
```javascript
logAutoActivity('error', `Relay ${slot} crashed (exit code ${code})`);
setTimeout(() => { spawnRelay(slot, saved); }, 3000); // Auto-restart after 3s
```

#### 9. Startup Relay Restoration
On boot, reads `relays.json`, kills live PIDs with `SIGTERM`, re-spawns via `spawnRelay` to get fresh proc handles for crash detection. Note: streams have brief interruption during restart (unlike crash recovery which is seamless).

#### 10. SSE Endpoints
- `/api/events`: Dashboard updates (relay state, history, schedules)
- `/api/auto-scheduler/events`: Activity log updates
Both use `clientSet` Set with heartbeat (30s ping) and auto-cleanup on disconnect.

---

## Frontend Architecture (`public/index.html` + `app.js`)

### Single File SPA
All HTML, CSS, and JavaScript are inlined in `index.html`. No build step or bundler.

### Navigation Pattern
- Uses History API: `/dashboard`, `/activity-log`, `/settings`
- Sidebar drawer (mobile) with hamburger toggle
- Page transitions tear down active relays (cleanup HLS instances)

### Key Functions

#### State Management
```javascript
let schedules = [];
let history = [];
let relayData = []; // From /api/relays
let m3uReady = false;
let hlsInstances = new Map(); // Slot -> Hls instance
let asData = {}; // Auto-scheduler config
```

#### API Helpers
```javascript
const api = async (method, path, body) => { /* fetch with auth check */ };
const GET = p => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const DELETE = p => api('DELETE', p);
```

#### Modal Management
- `showModal(id)`, `hideModal(id)` — toggle visibility
- Schedules modal (`#sched-modal`): new/edit form with schedule type picker
- Add-to-schedule modal (`#add-modal`): from search results
- Relay picker modal (`#relay-picker-modal`): slot selection

#### Schedule Actions
- **Run Now**: Launches relay immediately, removes from schedules if one-time
- **Edit**: Updates schedule (name, URL, type, time, slot)
- **Delete**: Removes without confirmation

#### M3U Flow
1. User enters URL → `GET` or `Refresh` button
2. `/api/m3u/download?url=` returns SSE stream with progress events
3. On complete: stores in `m3uMemCache`, persists to `data/m3u_cache.json`
4. Search input enabled, can filter channels
5. Auto-refresh toggle sets cron job (daily at configured time)

#### Relay Actions
- **Preview button** (eye): Loads HLS into hls.js video element
- **Stop button**: Sends `/api/relays/:slot/stop`, cleans up preview
- Slot selection in modals respects `maxSlots` setting (1–5)

#### Auto-Scheduler Flow
1. User configures search string, API endpoint, check time, default slot
2. Toggle enables/disables cron job (or manual run)
3. `/api/auto-scheduler/run` fires the event fetching logic
4. Activity log updates via SSE

---

## Module Details

### `src/relay-engine.js`

Factory function: `createRelayEngine(context)` returns object with:
- `findFreeSlot(preferred)`: Picks first free slot up to `maxSlots`; prefers given slot if within limit
- `spawnRelay(slot, s)`: Creates detached FFmpeg process, sets up exit listeners
- `killRelay(slot)`: Terminates relay via proc or PID
- `launchStream(s)`: Orchestrates spawn + history logging

**Context Parameters:**
- `getSettings()`: Returns settings from `data/settings.json`
- `ALL_SLOTS`: `['stream01', 'stream02', 'stream03', 'stream04', 'stream05']`
- `relays`: Shared Map for relay state
- `FFMPEG_PATH`: Resolved binary path (local bin or system)
- Callbacks: `saveRelays`, `logAutoActivity`, `getHistory`, `saveHistory`, `schedules`, `saveSchedules`, `serverLog`

**Exit Event Handling:**
- `code === null`: Relay was stopped (manual SIGKILL)
- `code === 0`: Ended unexpectedly (stream finished?)
- `code !== null, 0`: Crashed (auto-restart triggered if still in relays Map)

---

### `src/m3u-parser.js`

Function: `parseM3U(text)` — returns array of channel objects.

**Parsing Logic:**
1. Split by newlines, skip empty lines and lines starting with `#`
2. For each `#EXTINF:` line:
   - Extract: `name`, `logo` (tvg-logo), `group` (group-title), `id` (tvg-id)
   - Parse `tvg-name` for full "Channel | Event" string, extract ISO timestamp into `eventTime` field
3. Next non-`#` line becomes the URL stream

**Output Format:**
```javascript
{
  name: "ESPN",
  logo: "https://example.com/espn-logo.png",
  group: "Sports",
  id: "espn",
  eventTime: "2026-03-31T19:30", // optional, from tvg-name timestamp
  url: "http://example.com/stream.ts",
  searchName: "espn" // lowercase name for searching
}
```

**Optimizations:**
- Streamed persistence via `fs.createWriteStream` when saving cache
- In-memory cache (`m3uMemCache`) used for all searches (faster than disk)

---

### `src/auto-scheduler.js`

Function: `runAutoScheduler(context)` — orchestrates sports event fetching and scheduling.

**Flow:**
1. Validate config: `searchString`, `apiEndpoint`, `m3uMemCache.sourceUrl`
2. Optionally refresh M3U cache before run (if `refreshBeforeRun` enabled)
3. Fetch ESPN scoreboard API with date (Eastern timezone)
4. Filter events by `searchString` (case-insensitive, checks `competitors[].team.displayName` or `.location`)
5. For each game:
   - Find M3U channel matching game name and search string
   - If multiple matches, filter by opponent location if available
   - Generate one-time schedule for 10 minutes before game time
   - Skip if duplicate (same URL on same date)
6. Each scheduled event logged to `autoScheduler.activityLog`

**Time Handling:**
- API returns UTC; converted via `America/New_York` timezone (DST-aware)
- Game time offset +10 minutes to ensure stream is ready before kickoff
- Uses server's Eastern timezone for display formatting

---

## Data File Schema

### `config.json`
```json
{
  "port": 3000,
  "username": "admin",
  "passwordHash": "$2a$12$...",
  "sessionSecret": "hex-string"
}
```

### `schedules.json`
```json
[
  {
    "id": "uuid",
    "name": "Texas Tech vs Oklahoma",
    "url": "http://example.com/stream.ts",
    "logo": "https://...",
    "scheduleType": "cron|once",
    "runAt": "2026-04-01T20:30" || null,
    "cronExpr": "0 20 * * *" || null,
    "frequency": "daily|weekly|monthly" || null,
    "recurTime": "20:00",
    "recurDay": 1 || null, // 0-6 for weekly, 1-31 for monthly
    "preferredSlot": "stream02" || null,
    "enabled": true,
    "createdAt": "ISO timestamp",
    "lastRun": "ISO timestamp" || null,
    "nextRun": "ISO timestamp" || null
  }
]
```

### `settings.json`
```json
{
  "timezone": "America/New_York",
  "srsUrl": "rtmp://192.168.1.125/live",
  "srsWatchUrl": "https://stream.ipnoze.com/live",
  "maxSlots": 2,
  "m3uAutoRefresh": false,
  "m3uRefreshTime": "06:00",
  "debugLogging": false,
  "ffmpegLogPath": "/path/to/logs",
  "ffmpegLogMaxSizeMb": 10
}
```

### `auto_scheduler.json`
```json
{
  "enabled": false,
  "searchString": "Texas Tech",
  "apiEndpoint": "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
  "checkTime": "07:00",
  "refreshBeforeRun": false,
  "preferredSlot": null,
  "activityLog": [
    {
      "type": "info|warn|error|success",
      "message": "...",
      "timestamp": "ISO timestamp"
    }
  ] // capped at 100 entries
}
```

### `m3u_cache.json`
```json
{
  "fetchedAt": 1743465600000,
  "sourceUrl": "http://...",
  "byteSize": 123456,
  "channels": [ ... ] // full channel list from m3u-parser
}
```

### `relays.json`
```json
[
  {
    "slot": "stream02",
    "name": "ESPN - Texas Tech",
    "url": "http://...",
    "logo": "https://...",
    "startedAt": "ISO timestamp"
    // NOTE: proc and pid are NOT persisted (stripped for JSON serializability)
  }
]
```

### `history.json`
```json
[
  {
    "id": "uuid",
    "scheduleId": "uuid",
    "scheduleName": "ESPN - Texas Tech",
    "url": "http://...",
    "logo": "https://...",
    "player": "stream02",
    "startedAt": "ISO timestamp",
    "status": "launched"
  }
] // capped at 10 entries
```

---

## API Reference

### `/api/play-now`
Launches a stream immediately.

**Request (POST):**
```json
{
  "name": "Stream Name",
  "url": "http://...",
  "logo": "https://...",      // optional
  "preferredSlot": "stream02", // optional
  "force": true              // optional: kill existing relay if occupied
}
```

**Response:**
```json
{
  "ok": true,
  "slot": "stream02"
}
```

---

## Security Considerations

1. **Authentication**: Session-based with bcrypt password hashing (12 rounds)
2. **Session Store**: File-backed (`data/sessions.json`) for persistence across restarts
3. **Password Policy**: Minimum 6 characters, enforced on UI and API
4. **Rate Limiting**: No explicit limits — consider adding middleware for production
5. **CORS**: No CORS headers configured — binds to LAN access only by design
6. **HTTPS**: Not enforced by app; reverse proxy (Nginx/Caddy) should handle SSL
7. **Boot ID**: `/api/ping` returns unique boot ID; restart endpoint verifies ID change

---

## Common Operations

### Initial Setup
```bash
node setup.js
# Creates data/config.json with interactive prompts for:
# - Port (default: 3000)
# - Username (default: admin)
# - Password (min 6 chars, bcrypt hashed)
```

### Starting the Server
```bash
node server.js
# Output includes: ✓ Stream Scheduler running at http://0.0.0.0:PORT
```

### Windows Autostart (NSSM)
```bash
nssm install StreamSched node server.js
# In NSSM GUI: set Startup directory to project root, Service name = "StreamSched"
```

### Data Directory Structure
Ensure `data/` exists with proper permissions. Contents are created automatically on first run except for config.json (requires setup).

---

## Troubleshooting

### FFmpeg Crash Auto-Recovery Not Working
- Check debug logging: enable in Settings → Debug Logging
- Verify `relays.json` PIDs don't conflict (check for zombie processes)
- Ensure SRS is running and accepting RTMP connections

### M3U Cache Not Loading
- Verify `data/m3u_cache.json` exists and is valid JSON
- Check server logs for parse errors
- M3U URL must be HTTPS or allow HTTP from server IP

### Schedule Not Running at Expected Time
- Verify `checkTime` in auto-scheduler matches server's timezone (Eastern)
- One-time schedules delete after firing; recurring need cronExpr validation
- Activity log will show if ESPN API fetch failed or no matches found

---

## Environment Variables

None required. All configuration is managed via JSON files and UI settings.

---

## Notes for Coding Agents

### TypeScript Conversion
The project uses plain JavaScript. If converting to TypeScript, consider:
- Type definitions for all module factory contexts
- Strict typing for Map values (relay entries have nullable `proc`)
- JSDoc comments preserved from current codebase

### Breaking Changes
- Changing FFmpeg args could affect compatibility with certain streams
- Modifying cron expressions requires re-registering schedules
- Session secret in `config.json` must be updated if changing auth behavior

### Performance Considerations
- M3U cache uses streamed persistence to avoid blocking on large files
- In-memory cache provides fast search; disk used for persistence only
- SSE connections managed per-client; monitor connection count for high-scale deployments

### Testing Strategy
No test suite configured. Recommended additions:
- Unit tests for `m3u-parser.js` (M3U string → channel array)
- Mock FFmpeg spawning in relay-engine tests
- Schedule cron expression builder validation

---

## License

MIT License — see LICENSE file.