# Stream Scheduler - Project Documentation

## Overview

**Stream Scheduler** is a Node.js application that automates streaming content delivery using FFmpeg to relay streams from various sources (M3U playlists, Xtream codes) to an SRS (Simple Realtime Server) destination. It supports scheduled broadcasts and can auto-discover upcoming sports events via ESPN's API.

---

## Project Structure

```
stream-scheduler/
├── bin/                    # FFmpeg binary location
│   └── ffmpeg.exe          # Windows FFmpeg executable (must be installed separately)
├── data/                   # Persisted runtime data (created on first run)
│   ├── config.json         # App configuration (username, password hash)
│   ├── schedules.json      # Stream schedule definitions
│   ├── history.json        # Recent stream history log (max 10 entries)
│   ├── settings.json       # User settings
│   ├── auto_scheduler.json # Auto-scheduler configuration & activity logs
│   ├── relays.json         # Active relay state
│   └── m3u_cache.json      # Cached M3U playlist data (streamed format)
├── logs/                   # FFmpeg debug logs (if debug logging is enabled)
├── public/                 # Frontend assets
│   ├── index.html          # Main dashboard UI
│   ├── login.html          # Login page
│   ├── app.js              # Frontend JavaScript logic
│   ├── style.css           # Styling (uses CSS variables)
│   └── favicon*.png        # Icons for browser tabs
├── src/                    # Core server modules
│   ├── auto-scheduler.js   # ESPN API integration & schedule generation
│   ├── m3u-parser.js       # M3U playlist parser
│   └── relay-engine.js     # FFmpeg process management
├── setup.js                # Initial configuration wizard
├── start.bat               # Windows startup script (uses NSSM for service restart)
├── package.json            # Dependencies & NPM scripts
├── server.js               # Express server main entry point
└── README.md               # User documentation
```

---

## Architecture Overview

### Core Components

| Component | File(s) | Responsibility |
|-----------|---------|----------------|
| **Web Server** | `server.js` | Express-based HTTP/REST API, session management, SSE events |
| **Relay Engine** | `src/relay-engine.js` | Manages FFmpeg child processes for stream relaying |
| **M3U Parser** | `src/m3u-parser.js` | Parses M3U playlist format to extract channel metadata |
| **Auto-Scheduler** | `src/auto-scheduler.js` | ESPN API integration, game discovery, schedule generation |

---

## Data Flow Diagrams

### Stream Relay Process
```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Source URL    │────▶│   FFmpeg     │────▶│      SRS        │
│  (M3U/Xtream)   │     │  Process     │     │ (rtmp://host/)  │
└─────────────────┘     └──────────────┘     └─────────────────┘
         │                      │                     │
         ▼                      ▼                     ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Dashboard UI   │◀────│  Relay State │◀────│  Watch URL      │
│  (HLS Preview)  │     │  (relays.json│     │  /slot.m3u8      │
└─────────────────┘     └──────────────┘     └─────────────────┘
```

### Auto-Scheduler Flow
```
┌─────────────────┐
│   ESPN API      │  (GET /scoreboard?dates=YYYYMMDD)
└────────┬────────┘
         ▼
    Filter by search string
    (e.g., "Texas Tech")
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  M3U Cache      │────▶│ Match Channel    │
│  (m3u_cache.json)│    │   Name/Date     │
└─────────────────┘     └─────────────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐     ┌─────────────────┐
│ Create Schedule │────▶│ Register Cron   │
│ (schedules.json)│    │   Job           │
└─────────────────┘     └─────────────────┘
```

---

## Key Modules Explained

### 1. Server (`server.js`)

**Responsibilities:**
- Express server setup on configurable port (default: 3000)
- Session-based authentication with bcrypt password hashing
- File-based persistence for all data
- SSE event broadcasting for real-time UI updates
- Cron job scheduling via `node-cron`

**Key Patterns:**
```javascript
// Custom file-backed session store
class FileStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.path = options.path || path.join(DATA_DIR, 'sessions.json');
  }
  saveStore() { fs.writeFileSync(this.path, JSON.stringify(this.sessions)); }
}

// Write locks prevent concurrent file corruption
const writeLocks = new Map();
const writeJSON = (p, d) => { /* implements locking via Promise queue */ };

// Cron job registry for cleanup on schedule removal
const cronJobs = new Map(); // id → { type: 'timeout'|'cron', handle }
```

**API Endpoints Summary:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ping` | Health check with boot ID for restart detection |
| `POST` | `/api/auth/login` | User authentication |
| `POST` | `/api/auth/logout` | Session destruction |
| `PUT` | `/api/auth/change-password` | Update password (bcrypt hash) |
| `GET/PUT` | `/api/settings` | Read/update application settings |
| `GET/POST/DELETE` | `/api/schedules/*` | CRUD operations for schedules |
| `POST` | `/api/play-now` | Immediate stream launch |
| `GET` | `/api/history` | Recent stream history |
| `GET/POST` | `/api/relays/*` | Relay state management |
| `GET/POST` | `/api/m3u/*` | M3U download, caching, search |
| `GET` | `/api/auto-scheduler` | Auto-scheduler config & logs |

### 2. Relay Engine (`src/relay-engine.js`)

**Responsibilities:**
- Spawn detached FFmpeg processes via `child_process.spawn()`
- Manage relay lifecycle (start, stop, crash detection)
- Persist relay state to disk for crash recovery

**FFmpeg Arguments:**
```bash
ffmpeg -re \
  -fflags +genpts+discardcorrupt \
  -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -rw_timeout 5000000 \
  -i <input_url> \
  -c:v libx264 -preset veryfast -tune zerolatency -crf 23 -g 60 \
  -c:a aac -b:a 128k \
  -f flv -flvflags no_duration_filesize \
  rtmp://<srs-host>/<slot>
```

**Process Lifecycle:**
```javascript
proc.on('exit', (code) => {
  if (relays.has(slot)) { // Expected shutdown
    relays.delete(slot);
  } else if (code !== null && code !== 0) { // Crash detected
    logAutoActivity('error', `Relay ${slot} crashed`);
    // Auto-restart after 3s delay
    setTimeout(() => spawnRelay(slot, saved), 3000);
  }
});
```

### 3. M3U Parser (`src/m3u-parser.js`)

**Parses standard M3U format:**
```m3u
#EXTM3U
#EXTINF:-1 tvg-logo="https://example.com/logo.png" tvg-id="techtv" group-title="Sports",Tech TV (2026-03-31T19:00)
https://stream.example.com/playlist.m3u8
```

**Output Object:**
```javascript
{
  name: "Tech TV",
  logo: "https://example.com/logo.png",
  group: "Sports",
  id: "techtv",
  eventTime: "2026-03-31T19:00:00.000Z", // extracted from tvg-name ISO date
  url: "https://stream.example.com/playlist.m3u8",
  searchName: "tech tv" // lowercase for fuzzy matching
}
```

### 4. Auto-Scheduler (`src/auto-scheduler.js`)

**ESPN API Integration:**
- Endpoint: `https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard`
- Query parameter: `?dates=YYYYMMDD` (Eastern Time)
- Filters by team name/location in search string

**Schedule Generation Logic:**
1. Fetch today's events from ESPN API
2. Filter for games containing the search string
3. For each game, find matching M3U channel (name + date)
4. Auto-adjust run time: `game_start_time + 10 minutes`
5. Create one-time schedule with preferred slot

**Timezone Handling:**
```javascript
const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
autoSchedCronJob = cron.schedule(`${min} ${hour} * * *`, () => { ... }, 
  { timezone: 'America/New_York' });
```

---

## Frontend Architecture (`public/app.js`)

### State Management
- `schedules`: Loaded from `/api/schedules`
- `history`: Loaded from `/api/history`
- `relayData`: Active relays (polling via SSE)
- `asData`: Auto-scheduler config & activity log
- `m3uReady`: Boolean flag for search availability

### Real-Time Updates
```javascript
// Server-Sent Events connections
const connectDashboardSSE = makeSSE('/api/events', ({ type, relays }) => {
  if (type === 'history') loadHistory();
  if (type === 'relays') renderRelays(relays);
});

const connectAutoSchedSSE = makeSSE('/api/auto-scheduler/events', entry => {
  asData.activityLog.unshift(entry);
  renderAsLog();
});
```

### HLS Preview Implementation
- Uses `hls.js` library for non-browser-native HLS playback
- Polls SRS watch URL (HEAD requests) to detect stream readiness before attaching HLS player

---

## Configuration Files

### `data/config.json` (created by setup.js)
```json
{
  "username": "admin",
  "passwordHash": "$2a$12$..." 
}
```

### `data/settings.json` (optional, uses defaults if missing)
```json
{
  "srsUrl": "rtmp://192.168.1.125/live",
  "srsWatchUrl": "https://stream.ipnoze.com/live",
  "maxSlots": 2,
  "m3uAutoRefresh": false,
  "m3uRefreshTime": "06:00",
  "debugLogging": false,
  "ffmpegLogPath": "./logs"
}
```

### `data/auto_scheduler.json` (optional)
```json
{
  "enabled": false,
  "searchString": "Texas Tech",
  "apiEndpoint": "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
  "checkTime": "07:00",
  "refreshBeforeRun": false,
  "preferredSlot": null,
  "activityLog": []
}
```

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.18.2 | Web framework |
| `bcryptjs` | ^2.4.3 | Password hashing |
| `express-session` | ^1.17.3 | Session management |
| `node-cron` | ^3.0.3 | Scheduled tasks |
| `uuid` | ^9.0.0 | UUID generation |

**External Requirements:**
- **FFmpeg**: Must be installed and accessible via PATH or at `./bin/ffmpeg.exe`

---

## Development Workflow

### Starting the Application
```bash
npm start        # Starts Express server on port 3000
node setup.js    # Initial configuration wizard (run once)
start.bat        # Windows one-liner (uses NSSM for service management)
```

### Data Persistence Strategy
- All data stored as JSON in `data/` directory
- Write locking prevents concurrent corruption
- Session store persisted to disk on each change
- Relay state restored on startup (old processes killed, re-spawned)

### Crash Recovery
1. On exit: relay states saved to `relays.json`
2. On restart: old FFmpeg processes killed via PID lookup
3. Relays re-spawned with original parameters

---

## Troubleshooting Common Issues

| Issue | Solution |
|-------|----------|
| "config.json not found" | Run `node setup.js` first |
| FFmpeg not found | Ensure FFmpeg is in PATH or place at `./bin/ffmpeg.exe` |
| Session timeout too short | Increase cookie maxAge in server config |
| No M3U channels loaded | Enter URL and click "Get" button |
| Auto-scheduler not finding games | Verify API endpoint, check search string matches team names |

---

## Extensibility Points

### Adding New Sports Data Sources
1. Modify `src/auto-scheduler.js` to accept custom API endpoints
2. Adjust game name/channel matching logic as needed

### Custom Schedule Templates
1. Edit `server.js` schedule creation routes
2. Add validation for new schedule types

### Additional Relays
1. Configure in `settings.json` → `maxSlots` (max: 5)
2. Each slot maps to a unique RTMP path on SRS

---

## Security Considerations

- Passwords hashed with bcrypt (12 rounds default)
- Sessions stored server-side, expire after 90 days
- API endpoints require authentication middleware
- Image proxy validates URLs for https/http protocol only
- M3U download timeout: 120 seconds

---

*Last updated: 2026-03-31*