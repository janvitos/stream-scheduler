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

All server logic lives in one file. Key sections, in order:

- **Config/persistence** — reads `data/config.json` at startup (exits if missing). All state is held in memory and flushed to JSON files in `data/` on mutation via `readJSON`/`writeJSON` helpers.
- **Auth** — session-based (`express-session`). `requireAuth` middleware gates all routes below its `app.use()` call. Password is bcrypt-hashed in `config.json`.
- **REST API** — standard CRUD for schedules (`/api/schedules`), settings (`/api/settings`), history (`/api/history`), and M3U/Xtream (`/api/m3u/*`). A catch-all `GET *` route at the bottom serves `index.html` for History API navigation (e.g. `/settings`).
- **Scheduler engine** — `registerSchedule`/`unregisterSchedule` manage a `cronJobs` Map. One-time schedules use `setTimeout`; recurring use `node-cron`. All enabled schedules are re-registered at startup.
- **OBS integration** — `withOBS(fn)` helper manages OBS WebSocket connections. `setOBSMediaSource(obs, url)` sets the source URL on either the `Media` or `VLC Video` source (based on `settings.obsSourceType`) and controls scene item visibility — showing the active source and hiding the inactive one. `launchPlayer()` logs the history entry immediately (before OBS ops), then calls `ensureOBSStreaming()` + `setOBSMediaSource()`. A race condition guard prevents `nowPlaying` from being overwritten if the stream was stopped mid-launch.
- **Auto-Scheduler** — daily cron job (configurable time, Eastern timezone) that hits the ESPN scoreboard API, finds games matching a search string, searches the M3U cache for a matching channel, and auto-creates a one-time schedule. State persisted in `data/auto_scheduler.json`. Activity log includes M3U refresh events (manual and automatic).
- **SSE** — `createSSEEndpoint(clientSet)` factory creates event-stream endpoints. `broadcastSSE(clientSet, data)` pushes to all connected clients. Two endpoints: `/api/events` (dashboard) and `/api/auto-scheduler/events` (activity log).
- **Preview** — WebSocket at `/ws/preview` spawns a per-client `ffmpeg.exe` process (from `bin/`) that reads the configurable RTMP URL (`settings.rtmpUrl`) and pipes MPEG-TS fragmented MP4 to the browser.
- **RTMP detection** — `GET /api/obs/rtmp-url` connects to OBS and calls `GetStreamServiceSettings` to return the configured RTMP server + key as a combined URL.

### Frontend (`public/index.html`)

Single HTML file with all CSS and JS inline. Navigation uses the History API (`pushState`) — clean URLs like `/settings` instead of `#settings`. An `#app-loader` overlay prevents any flash of unstyled content on page load; it is removed only after all API calls complete and fonts are ready.

Key utilities:
- `debounce(fn, ms)` — used for auto-save inputs
- `buildSchedulePayload(prefix, url)` — shared between New Schedule and Add Channel modals
- `showM3UMessage(type, text)` — unified M3U status messages
- `setToggleState(el, on)` — sets `.toggle-on` class on toggle switches
- `makeSSE(url, onMessage)` — SSE connection factory with auto-reconnect
- `withOBS` / `GET` / `POST` / `PUT` / `DELETE` — fetch helpers

UI patterns:
- Channel cards (search results) and Recent Activity cards are **fully clickable** — no inline buttons. Clicking opens the schedule modal or replays the stream respectively.
- All buttons use a **semi-transparent tinted style**: `rgba(color, .12)` background, vivid color text, `rgba(color, .25)` border. Green = action, blue = edit, red = delete/stop/danger.
- Square 38×38 `sched-btn` variants: `sched-btn-edit` (blue), `sched-btn-delete` (red), `sched-btn-stop` (red), `sched-btn-active` (outlined green, used for preview active state).

### Data files (`data/`)

| File | Contents |
|------|----------|
| `config.json` | Port, username, bcrypt password hash, session secret |
| `schedules.json` | Array of schedule objects |
| `history.json` | Last 10 playback entries |
| `settings.json` | `obsSourceType`, `rtmpUrl`, `rtmpAutoDetect`, `m3uAutoRefresh`, `m3uRefreshTime` |
| `auto_scheduler.json` | Auto-scheduler config + activity log |
| `m3u_cache.json` | Persisted M3U channel list |
| `now_playing.json` | Persisted now-playing state (survives restarts) |

### Key design notes

- **OBS source types** — `settings.obsSourceType` is either `'media'` (OBS Media Source, named exactly `Media`) or `'vlc'` (VLC Video Source, named exactly `VLC Video`). `setOBSMediaSource` automatically shows the active source and hides the inactive one in the current scene.
- **M3U cache is dual-layer** — disk (`m3u_cache.json`) loaded into `m3uMemCache` at startup; all searches run against the in-memory copy.
- **History cap is 10** — enforced in `saveHistory()`.
- **`nowPlaying` persistence** — saved to `data/now_playing.json` on every change. On startup, if OBS is not streaming, `nowPlaying` is not cleared automatically — `launchPlayer` does a real-time OBS status check when the same URL is requested to decide whether to skip or proceed.
- **`launchPlayer` dedup logic** — skips if `nowPlaying.url === s.url && !nowPlaying.stopped`, but only after confirming via `GetStreamStatus` that OBS is actually streaming. If OBS is not streaming, proceeds regardless.
- **Preview RTMP URL** — configurable via `settings.rtmpUrl`. Can be auto-detected from OBS via `GET /api/obs/rtmp-url` (reads `GetStreamServiceSettings`). Auto-detect only fires when `settings.rtmpAutoDetect` is true and the field is empty.
- **Restart endpoint** — `POST /api/system/restart` calls `nssm restart StreamSched` via a detached `cmd.exe` process, so it only works when running as an NSSM service named `StreamSched`.
- **`bin/ffmpeg.exe`** — bundled Windows FFmpeg binary used exclusively for the live preview WebSocket feature.
- **Fonts** — Inter is self-hosted (`public/fonts/`, 5 woff2 files for weights 400–800, Latin subset). No Google Fonts CDN dependency.
