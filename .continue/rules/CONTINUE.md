# Stream Scheduler — Project Guide

> **Project:** `stream-scheduler`  
> **Version:** 1.0.0  
> **Description:** A Node.js-based stream URL scheduler with Xtream/M3U support, designed to manage and relay live video streams via FFmpeg and SRS (Simple Real-time Server).

---

## Table of Contents

- [Project Overview](#project-overview)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Key Concepts](#key-concepts)
- [Common Tasks](#common-tasks)
- [Troubleshooting](#troubleshooting)
- [References](#references)

---

## Project Overview

### Purpose

`stream-scheduler` is a web application that:

1. **Downloads and parses M3U/Xtream playlist files** to extract channel metadata (name, logo, event time).
2. **Schedules streams** to be relayed at specific times or on-demand using FFmpeg as publishers and SRS as the RTMP ingest server.
3. **Provides a dashboard UI** for managing active relays, viewing recent activity, and configuring schedules.
4. **Supports automatic scheduling** of sports events based on ESPN API data (configurable search strings like team names).

### Technologies Used

| Layer | Technology |
|-------|------------|
| Runtime | Node.js (`node server.js`) |
| Web Framework | Express 4.x |
| Session Management | express-session |
| File I/O Persistence | JSON files in `./data/` directory |
| Scheduling | node-cron (Cron expressions + timeouts) |
| Video Processing | FFmpeg (spawned as child processes) |
| Streaming Protocol | RTMP → HLS (via SRS, `.m3u8`) |
| Frontend | Vanilla HTML/CSS/JS (no build system) |
| Real-time Updates | Server-Sent Events (SSE) |

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         stream-scheduler                      │
│  ┌──────────────┐    ┌────────────────────────────────────┐ │
│  │   Express App│    │         FFmpeg (Child Process)     │ │
│  ├──────────────┤    │                                     │ │
│  │  /api/...    │◄───┼─── RTMP Input → SRS → HLS Output   │ │
│  │              │    └────────────────────────────────────┘ │
│  │  Session Auth │                                         │
│  │  JSON File I/O│                                        │
│  └──────────────┘                                          │
│                                                              │
│         ┌─────────────────────────────────────┐             │
│         │           Data Directory            │             │
│         │  ├─ config.json (port, credentials) │             │
│         │  ├─ schedules.json                  │             │
│         │  ├─ relays.json                     │             │
│         │  ├─ history.json                    │             │
│         │  ├─ settings.json                   │             │
│         │  └─ auto_scheduler.json             │             │
└─────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites

1. **Node.js** (v18+ recommended)
2. **FFmpeg** installed on the system:
   - Windows: `ffmpeg.exe` in `bin/` or any directory on PATH
   - Linux/macOS: `ffmpeg` binary available globally
3. A web browser to access the dashboard

### Installation

```bash
# Install dependencies (already done if package-lock.json exists)
npm install

# Run setup wizard once — creates data/config.json with hashed credentials
node setup.js

# Start the server
npm start
# or
node server.js
```

### Basic Usage

1. Open `http://localhost:3000` in your browser
2. Log in with admin credentials (default username set during setup)
3. **Load an M3U/Xtream playlist**:
   - Go to Settings → enter the Xtream/M3U URL → click "Get"
4. **Search for a channel** and add it to schedules, or
5. **Manually create a schedule** via the Schedules tab

### Running Tests

No formal test suite is included. Manual verification steps:

- Start server and confirm dashboard loads
- Try loading an M3U file and searching for channels
- Create a one-time schedule and verify it runs at the scheduled time
- Check FFmpeg logs in `./logs/` (when debug logging enabled)

---

## Project Structure

```
stream-scheduler/
├─ .continue/                 # AI assistant rules directory
│  └─ rules/
│     ├─ CONTINUE.md          # This file
│     └─ style.css            # Optional custom styling (if needed)
├─ bin/
│  └─ ffmpeg.exe              # Windows-specific FFmpeg binary
├─ data/                      # JSON persistence layer (created by setup.js or server)
│  ├─ config.json             # Admin credentials, port, session secret
│  ├─ schedules.json          # User-defined stream schedules
│  ├─ relays.json             # Active relay states (slot → {url, startedAt, ...})
│  ├─ history.json            # Recent activity log (last N entries)
│  ├─ settings.json           # SRS URLs, max slots, M3U refresh preferences
│  ├─ auto_scheduler.json     # ESPN API config and daily check settings
│  └─ m3u_cache.json          # Cached parsed channels from last download
├─ logs/                      # FFmpeg debug logs (when enabled)
├─ public/                    # Static HTML/CSS/JS assets
│  ├─ index.html              # Main dashboard page
│  ├─ login.html              # Login page (if session expired)
│  ├─ style.css               # Dashboard styling
│  └─ fonts/, favicon*.png    # Assets
├─ setup.js                   # Setup wizard script
├─ server.js                  # Main Express application entry point
├─ package.json               # Node dependencies and scripts
├─ README.md                  # Original project readme (if exists)
├─ LICENSE                    # Project license
└─ start.bat                  # Windows batch launcher (convenience)
```

### Key Files

| File | Role |
|------|------|
| `server.js` | Main Express app with all API routes and cron jobs |
| `setup.js` | Interactive setup wizard to create config.json |
| `.continue/rules/CONTINUE.md` | AI context rules for this project (this file) |

### Configuration Files

#### `data/config.json`

```json
{
  "port": 3000,
  "username": "admin",
  "passwordHash": "$2b$12$...",
  "sessionSecret": "<random-64-char-hex>"
}
```

Edit only if you need to change the admin account or server port.

#### `data/settings.json` (optional — uses defaults)

```json
{
  "srsUrl": "rtmp://192.168.1.125/live",
  "srsWatchUrl": "https://stream.ipnoze.com/live",
  "maxSlots": 2,
  "m3uAutoRefresh": false,
  "ffmpegLogPath": "./logs"
}
```

#### `data/auto_scheduler.json` (optional — uses defaults)

```json
{
  "enabled": true,
  "searchString": "Texas Tech",
  "apiEndpoint": "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
  "checkTime": "07:00"
}
```

---

## Development Workflow

### Coding Standards & Conventions

- **File naming:** Kept minimal; prefer lowercase with `-` (e.g., `server.js`, not `Server.js`)
- **JSON persistence:** All state is stored as JSON files — no ORM, so keep structures simple and flat
- **Error handling:** Use `.catch()` for async operations; log errors to console or activity log
- **Session management:** Admin auth via bcrypt; avoid storing sensitive data in client-side JS

### Testing Approach

Manual verification recommended:

1. Start server with `npm start`
2. Confirm dashboard loads and login works
3. Load an M3U file → search → add a channel to schedule
4. Verify FFmpeg spawns (check logs if debug enabled)
5. Check activity log for expected entries

### Build & Deployment

There is no build process — the project runs as-is after `npm install`.

**Deployment considerations:**

- Ensure FFmpeg binary path is accessible (or copy `bin/ffmpeg.exe` to deployment server)
- Set appropriate filesystem permissions for `./data/` and `./logs/`
- Consider environment variables for port/config in production instead of hardcoding

### Contribution Guidelines

1. Fork the repo and create a branch
2. Make focused changes (e.g., add new API endpoint, fix bug)
3. Test locally before committing
4. Commit with clear messages referencing issues or PRs
5. Push and open a pull request

---

## Key Concepts

### SRS Relay Slots

The app uses up to 5 relay slots (`stream01` … `stream05`), but the default max is configurable in settings (default: 2). Each slot represents an RTMP ingest channel on SRS. When all slots are occupied, new streams fail until a slot frees up.

### Schedule Types

| Type | Description |
|------|-------------|
| `now` | Launch immediately; no cron entry created |
| `once` | Single run at specified datetime; deleted after execution |
| `cron` | Recurring (daily, weekly, monthly) using node-cron expressions |

### Auto-Scheduler

The auto-scheduler uses the ESPN API to find games based on a search string (e.g., "Texas Tech"). Each game is matched against M3U channels by name and event date. Schedules are created automatically for matches found.

### FFmpeg Child Process Management

FFmpeg processes are spawned as detached child processes (`proc.unref()`). The server tracks their exit codes to detect crashes or unexpected terminations. On crash, the relay auto-restarts after a 3-second delay if configured in settings.

---

## Common Tasks

### Task: Load an M3U/Xtream Playlist

```bash
# From browser (or curl):
curl -X POST http://localhost:3000/api/m3u/use-cache \
  && curl "http://localhost:3000/api/m3u/download?url=<xtream-url>"
```

Or manually via the UI: Settings → enter Xtream URL → click **Get**

### Task: Create a One-Time Schedule

1. Search for channels in M3U (Settings → load M3U)
2. Click a channel → "Add to Schedules"
3. Choose schedule type (`once`) and pick run time
4. Save — the schedule is created in `data/schedules.json`

### Task: Launch a Stream Immediately ("Play Now")

```bash
curl -X POST http://localhost:3000/api/play-now \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Manual Stream",
    "url": "rtmp://example.com/stream123",
    "preferredSlot": null,
    "force": false
  }'
```

### Task: Check Active Relays

```bash
curl http://localhost:3000/api/relays
# Returns: [{slot:"stream01",name:"...","url":"...",logo:null,"startedAt":"2025-..."},...]
```

Stop a relay:

```bash
curl -X POST "http://localhost:3000/api/relays/stream01/stop"
```

### Task: Toggle Auto-Scheduler

Enable/disable via UI (Settings → Auto-Scheduler section) or API:

```bash
# Enable
curl -X POST http://localhost:3000/api/auto-scheduler/enable

# Disable
curl -X POST http://localhost:3000/api/auto-scheduler/disable
```

### Task: Clear History

Delete all entries from `data/history.json`:

```bash
curl -X DELETE http://localhost:3000/api/history
```

---

## Troubleshooting

### FFmpeg not spawning

**Symptoms:** "Failed to spawn FFmpeg" error in activity log.

**Solutions:**

1. Confirm FFmpeg binary exists and is executable:
   ```bash
   which ffmpeg              # Linux/macOS
   where ffmpeg.exe          # Windows PowerShell
   ```
2. If using `bin/ffmpeg.exe` on Windows, ensure it's in the same directory as Node process or adjust path via Settings → FFmpeg Log Directory (this sets log dir, but binary path is relative to server root)
3. Check for permission issues:
   ```bash
   ls -l bin/ffmpeg.exe      # Should be -rwxr-xr-x or similar
   ```

### No relay slots available

**Symptoms:** "No relay slots available" error when launching a stream.

**Solutions:**

- Increase max slots in Settings → Max Streams (1–5)
- Wait for existing streams to complete, or manually stop one with `/api/relays/:slot/stop`

### M3U download fails

**Symptoms:** "Parse error: ..." or connection timeout.

**Solutions:**

- Verify the Xtream/M3U URL is accessible and returns valid M3U content
- Check network/firewall rules (some corporate networks block certain ports)
- Try a smaller subset of channels first to test parsing

### Activity log not updating in real-time

The activity log updates via Server-Sent Events (`/api/auto-scheduler/events`). If your browser blocks SSE, check:

1. Browser console for "blocked auto-disconnected EventSource" errors
2. CORS headers (should be set by the server — if custom proxy is used)

### FFmpeg logs not appearing

**Symptoms:** No `.log` files in `./logs/`.

**Solutions:**

- Enable debug logging in Settings → Debug Logging toggle
- Check FFmpeg Log Max File Size setting (default 10 MB — may rotate old files)
- Verify the log path is writable: `ls -ld ./logs`

---

## References

### Project Documentation

- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [Express.js Guide](https://expressjs.com/)
- [node-cron API](https://github.com/nodecron/node-cron)

### External APIs

- ESPN College Baseball Scoreboard:  
  `https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard`

### M3U Parsing Standards

The parser follows [M3U8 standard](https://github.com/abesingh/m3u8) conventions for extracting channel metadata from Xtream playlists.

---

## Notes & Future Work

- Consider adding rate limiting to API endpoints (e.g., `/api/m3u/download`)
- Add health check endpoint (`/health`) for load balancers
- Persist FFmpeg process handles more robustly; currently relies on exit code monitoring only

---

*Last updated: 2025-12-30*  
*Maintained by the Stream Scheduler team*