# Stream Scheduler — CONTINUE Guide

This guide helps you understand, develop, and maintain the Stream Scheduler application.

---

## 1. Project Overview

**Stream Scheduler** is a Node.js-based streaming management application that:

- Fetches TV channels from Xtream or M3U sources
- Schedules streams for specific times (one-time or recurring)
- Automatically relays live streams using FFmpeg to an RTMP destination (SRS server)
- Provides a web dashboard for managing schedules, searching channels, and monitoring active relays
- Supports auto-discovery of sports events via ESPN API

**Key Technologies:**
- **Backend:** Node.js + Express.js
- **Streaming:** FFmpeg → SRS (Simple Realtime Streaming) Protocol
- **Session Management:** express-session with bcryptjs for auth
- **Task Scheduling:** node-cron for recurring schedules and auto-refresh
- **Frontend:** Vanilla JavaScript with HTML/CSS (no frameworks)
- **Event Streaming:** Server-Sent Events (SSE) for real-time updates

**Architecture:**
```
┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│  Xtream/M3U URL │────▶│  M3U Cache   │◀───▶│   SRS Server  │
└─────────────────┘     └──────────────┘     └──────────────┘
                              ▲                    ▲
                              │                    │
                      ┌───────┴────────┐  ┌───────┴───────┐
                      │   Stream Scheduler│  │              │
                      │ (Express Server)  │  │   FFmpeg     │
                      └───────────────────┘  └──────────────┘
                              ▲                    ▲
                              │                    │
                          Web Dashboard   Activity Logs
```

---

## 2. Getting Started

### Prerequisites

- **Node.js** (v16+ recommended) and npm
- **FFmpeg** installed system-wide OR place `ffmpeg.exe` in the project's `bin/` folder
- **Git** for version control
- A browser for accessing the web UI

### Installation

```bash
# Navigate to project root
cd stream-scheduler

# Install dependencies
npm install

# Run setup wizard (creates config.json)
node setup.js

# Start the server
npm start
# or
node server.js
```

The first time you run `setup.js`, it will prompt for:
- Port number (default: 3000)
- Admin username
- Admin password

### Basic Usage

1. Open your browser to `http://localhost:3000`
2. Log in with the credentials from setup
3. **Settings Tab:** Configure your SRS relay URLs and max streams
4. **Dashboard Tab:** Search for channels or add schedules
5. **Activity Log:** Monitor recent stream launches

### Running Tests

This project doesn't have formal unit tests yet. The main "tests" are:
- Manual testing via the web UI
- Verify scheduled streams launch at expected times
- Check that FFmpeg processes start and stop correctly

---

## 3. Project Structure

```
stream-scheduler/
├── .continue/                # Continue rules directory
│   └── rules/
│       └── CONTINUE.md       # This file
├── bin/                      # Place ffmpeg.exe here on Windows (optional)
├── data/                     # Auto-created at runtime:
│   ├── config.json          # Admin credentials, port, session secret
│   ├── schedules.json       # Scheduled streams
│   ├── history.json         # Recent launch history (max 10 entries)
│   ├── settings.json        # SRS URLs, max slots, logging preferences
│   ├── auto_scheduler.json  # ESPN API config and activity log
│   └── relays.json          # Active relay state on restart
├── public/                   # Static assets:
│   ├── index.html           # Main dashboard
│   ├── login.html           # Login page
│   ├── app.js               # Frontend application logic
│   └── style.css            # (if exists) styles
├── server.js                # Express server + all backend logic
├── setup.js                 # Initial configuration wizard
├── start.bat                # Windows batch script to launch
└── LICENSE                  # Project license
```

### Key Files Explained

| File | Purpose |
|------|---------|
| `server.js` | Main Express server with all API routes and streaming logic |
| `setup.js` | Interactive setup wizard for creating config.json |
| `data/config.json` | Admin credentials, port number (created by setup.js) |
| `data/schedules.json` | Persistent schedule definitions |
| `data/relays.json` | Relay state restored on server restart |

---

## 4. Development Workflow

### Coding Standards

- **Backend:** ES2015+ with CommonJS modules (`require()`)
- **Frontend:** Vanilla JavaScript, no frameworks or build tools
- **API:** RESTful conventions (GET/POST/PUT/DELETE)
- **Logging:** Console logs controlled by `debugLogging` setting

### Testing Approach

Since this is a streaming application:

1. **Manual UI testing** is primary verification method
2. Schedule a test stream and verify it launches at expected time
3. Check FFmpeg processes are spawned correctly (use `tasklist` on Windows)
4. Verify SRS URLs are accessible in browser for preview

### Build & Deployment

**Development:**
```bash
node server.js
# Or use the batch script
start.bat
```

**Production Considerations:**
- The server uses a detached process manager (NSSM mentioned in restart API)
- For production, consider:
  - Using PM2 or similar process manager instead of NSSM
  - Setting up proper logging aggregation
  - Configuring HTTPS with TLS certificates
  - Database migration for schedules/history if scaling

---

## 5. Key Concepts

### SRS Protocol

The application uses **Simple Realtime Streaming (SRS)** protocol:

- **Input:** RTMP stream from FFmpeg (`rtmp://host/live/stream01`)
- **Output:** HLS/m3u8 URLs for browser playback
- **Slots:** Named streams `stream01` through `stream05` (configurable max)

### Relay Slots

Each active relay uses an FFmpeg process:

```javascript
const ALL_SLOTS = ['stream01', 'stream02', 'stream03', 'stream04', 'stream05'];
// Configurable via settings.maxSlots (default: 2, min: 1, max: 5)
```

**Slot Lifecycle:**
1. Schedule triggers → `findFreeSlot()` selects available slot
2. FFmpeg spawned with `-re` flag for continuous replay mode
3. Stream published to SRS input URL + slot name
4. HLS manifest available at watch URL (e.g., `https://stream.ipnoze.com/live/stream01.m3u8`)

### Auto-Scheduler

The **Auto-Scheduler** feature:

- Polls ESPN API for sports events
- Matches against M3U channel list using search strings
- Creates one-time schedules for matching games
- Runs daily at configured time (Eastern timezone)

**Example:** Find all "Texas Tech" basketball games and schedule them automatically.

### M3U Cache

M3U files are cached to avoid repeated downloads:

```javascript
const MAX_HISTORY = 10; // Only last 10 entries kept
let m3uMemCache = null; // In-memory cache with source URL tracking
```

---

## 6. Common Tasks

### Add a New Schedule

**Via API:**
```bash
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ESPN News",
    "url": "http://example.com/espn.m3u",
    "scheduleType": "once",
    "runAt": "2024-01-15T20:00:00.000Z"
  }'
```

**Via UI:**
1. Go to Dashboard → Search for channels
2. Click a channel → "Add to Schedule"
3. Choose schedule type (Now/Once/Cron)
4. Set time and save

### Configure SRS URLs

Edit Settings tab:
- **SRS Input URL:** Where FFmpeg publishes (`rtmp://192.168.1.125/live`)
- **Watch Base URL:** HLS manifest base (`https://stream.ipnoze.com/live`)

Example preview URL for `stream01`:
```
https://stream.ipnoze.com/live/stream01.m3u8
```

### Refresh M3U Cache

**Manual refresh:**
1. Settings → Enter Xtream/M3U URL → Click "Get"
2. Wait for progress bar to complete

**Auto-refresh:** Enable toggle in Settings, set time (e.g., `06:00` daily)

### Debugging FFmpeg Issues

Enable debug logging in Settings:
- Check log files in configured directory
- View recent activity log for error messages
- FFmpeg errors typically show as "Relay crashed" with exit code

---

## 7. Troubleshooting

### Stream won't launch

**Checklist:**
1. Is SRS URL reachable? Test with `curl` or browser
2. Does FFmpeg exist in `bin/ffmpeg.exe` (Windows) or system PATH?
3. Are you over max slots limit? Check Settings → Max Streams
4. Look at Activity Log for error messages

### "Slot already occupied"

- Each slot can only run one stream at a time
- Use "Auto" dropdown to pick next available slot
- Or stop existing streams via the dashboard preview button

### M3U search returns no results

1. Ensure M3U file is cached (Settings → Get)
2. Search string must match channel name exactly
3. Some channels have dynamic names with date suffixes

### FFmpeg process not restarting after crash

Check `relays.json` in data directory:
- Old processes may be zombie'd
- Restart service via "Restart Service" button or kill old processes manually

### Activity log shows errors

```javascript
// Log levels controlled by settings.debugLogging
// Enable in Settings tab → Debug logging toggle
```

---

## 8. References

**Documentation:**
- [Express.js Guide](https://expressjs.com/) - Backend framework docs
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html) - Streaming options
- [SRS Protocol](http://srs.oss-cn-shanghai.aliyuncs.com/) - Simple Realtime Streaming
- [node-cron](https://github.com/nodecron/node-cron) - Task scheduling library

**Related APIs:**
- ESPN API: `https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard`
- HLS.js: https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js

**Project-Specific Resources:**
- See Activity Log for runtime issues
- Check FFmpeg logs in configured directory (default: `./logs`)
- Review recent history in Dashboard for launched streams

---

## Notes & Future Improvements

### Areas marked as "needs verification" or "assumption":

1. **Database persistence:** Currently uses JSON files; database migration could be added later
2. **Process management:** Uses NSSM on Windows; PM2 recommended for production Linux deployment
3. **HTTPS setup:** TLS certificates not configured; add if deploying to public server
4. **Rate limiting:** API calls currently unthrottled; consider adding rate limits in production

### Suggested rule files:

Consider creating additional rules.md files in subdirectories:
- `.continue/rules/backend.md` - For Express.js-specific guidance
- `.continue/rules/frontend.md` - For UI development patterns  
- `.continue/rules/deployment.md` - For production deployment notes

---

*Generated from project analysis. Review and customize as needed before committing.*