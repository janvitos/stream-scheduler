# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup (creates data/config.json with port, username, hashed password)
node setup.js  # or: npm run setup

# Start the server
node server.js  # or: npm start
```

No build step, no tests, no linter configured.

## Architecture

This is a single-file Node.js backend (`server.js`) with a single-page frontend (`public/index.html`). There is no bundler or framework — the frontend is vanilla JS/CSS inline in the HTML file.

### Backend (`server.js`)

All server logic lives in one file (~886 lines). Key sections, in order:

- **Config/persistence** — reads `data/config.json` at startup (exits if missing). All state is held in memory and flushed to JSON files in `data/` on mutation via `readJSON`/`writeJSON` helpers.
- **Auth** — session-based (`express-session`). `requireAuth` middleware gates all routes below its `app.use()` call. Password is bcrypt-hashed in `config.json`.
- **REST API** — standard CRUD for schedules (`/api/schedules`), settings (`/api/settings`), history (`/api/history`), and M3U/Xtream (`/api/m3u/*`).
- **Scheduler engine** — `registerSchedule`/`unregisterSchedule` manage a `cronJobs` Map. One-time schedules use `setTimeout`; recurring use `node-cron`. All enabled schedules are re-registered at startup.
- **OBS integration** — `launchPlayer()` connects to OBS WebSocket on `localhost:4455`, sets the `Media` input source URL, and optionally starts the stream. This replaces the old MPV/VLC launcher entirely.
- **Auto-Scheduler** — daily cron job (configurable time, Eastern timezone) that hits the ESPN scoreboard API, finds games matching a search string, searches the M3U cache for a matching channel, and auto-creates a one-time schedule. State persisted in `data/auto_scheduler.json`.
- **SSE** — two event-stream endpoints: `/api/events` (dashboard refresh) and `/api/auto-scheduler/events` (activity log). Clients push to `dashboardSSEClients` / `autoSchedSSEClients` Sets.
- **Preview** — WebSocket at `/ws/preview` spawns a per-client `ffmpeg.exe` process (from `bin/`) that reads `rtmp://localhost/live/stream` and pipes MPEG-TS fragmented MP4 to the browser.

### Frontend (`public/index.html`)

Single HTML file with all CSS and JS inline. Tabs/panels rendered/hidden via `showView()`. Makes `fetch()` calls to the REST API and connects to SSE + WebSocket endpoints directly. No build step.

### Data files (`data/`)

| File | Contents |
|------|----------|
| `config.json` | Port, username, bcrypt password hash, session secret |
| `schedules.json` | Array of schedule objects |
| `history.json` | Last 10 playback entries |
| `settings.json` | Player path/args (legacy, OBS now used) |
| `auto_scheduler.json` | Auto-scheduler config + activity log |
| `m3u_cache.json` | Persisted M3U channel list |

### Key design notes

- **OBS is the player** — `launchPlayer()` no longer spawns MPV/VLC. It connects to OBS WebSocket and sets the `Media` source. The `settings.json` player path fields are legacy/unused.
- **M3U cache is dual-layer** — disk (`m3u_cache.json`) loaded into `m3uMemCache` at startup; all searches run against the in-memory copy.
- **History cap is 10** — `MAX_HISTORY = 5` is defined but the actual enforced limit throughout the code is 10 (`history.slice(-10)`, `history.shift()` when `> 10`).
- **Restart endpoint** — `POST /api/system/restart` calls `nssm restart StreamSched` via a detached `cmd.exe` process, so it only works when running as an NSSM service named `StreamSched`.
- **`bin/ffmpeg.exe`** — bundled Windows FFmpeg binary used exclusively for the live preview WebSocket feature.
