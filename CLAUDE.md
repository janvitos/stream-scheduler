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
- **REST API** — standard CRUD for schedules (`/api/schedules`), settings (`/api/settings`), history (`/api/history`), relays (`/api/relays`), and M3U/Xtream (`/api/m3u/*`). Key endpoints: `POST /api/play-now` launches a relay immediately; `DELETE /api/relays/:slot` stops a relay. A catch-all `GET *` route at the bottom serves `index.html` for History API navigation (e.g. `/settings`).
- **Scheduler engine** — `registerSchedule`/`unregisterSchedule` manage a `cronJobs` Map. One-time schedules use `setTimeout`; recurring use `node-cron`. All enabled schedules are re-registered at startup.
- **Relay engine** — `findFreeSlot(preferred)` picks the next available slot up to `settings.maxSlots`. `spawnRelay(slot, s)` spawns `bin/ffmpeg.exe` re-encoding the IPTV stream and pushing RTMP to `settings.srsUrl/<slot>`. `launchStream(s)` wraps both, sets the relay in the `relays` Map, persists state, and logs history. On FFmpeg exit with non-zero code, the error is logged to the Activity Log and the slot is freed. The `relays` Map holds `{ slot, name, url, logo, startedAt, pid, proc }` — `proc` is stripped when serialising to disk.
- **Startup relay restoration** — `relays.json` is read at boot. For each persisted relay, `process.kill(pid, 0)` checks if the FFmpeg process is still alive. Alive PIDs are restored into the relays Map (without a proc handle). Dead ones are discarded. This allows FFmpeg processes to survive a Node.js restart.
- **Auto-Scheduler** — daily cron job (configurable time, Eastern timezone) that hits the ESPN scoreboard API, finds games matching a search string, searches the M3U cache for a matching channel, and auto-creates a one-time schedule. State persisted in `data/auto_scheduler.json`. Activity log includes M3U refresh events (manual and automatic) and relay error events.
- **SSE** — `createSSEEndpoint(clientSet)` factory creates event-stream endpoints. `broadcastSSE(clientSet, data)` pushes to all connected clients. Two endpoints: `/api/events` (dashboard) and `/api/auto-scheduler/events` (activity log). The dashboard SSE emits event types: `relays`, `schedule`, `history`.
- **Restart endpoint** — `POST /api/system/restart` calls `nssm restart StreamSched` via a detached `cmd.exe` process, so it only works when running as an NSSM service named `StreamSched`.

### Frontend (`public/index.html`)

Single HTML file with all CSS and JS inline. Navigation uses the History API (`pushState`) — clean URLs like `/settings` instead of `#settings`. An `#app-loader` overlay prevents any flash of unstyled content on page load; it is removed only after all API calls complete and fonts are ready. hls.js is loaded from CDN (`https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js`) for in-browser HLS preview.

Key utilities:
- `debounce(fn, ms)` — used for auto-save inputs
- `buildSchedulePayload(prefix, url)` — shared between New Schedule and Add Channel modals; includes `preferredSlot`
- `showM3UMessage(type, text)` — unified M3U status messages
- `setToggleState(el, on)` — sets `.toggle-on` class on toggle switches
- `makeSSE(url, onMessage)` — SSE connection factory with auto-reconnect
- `GET` / `POST` / `PUT` / `DELETE` — fetch helpers
- `populateSlotDropdown(id, selectedSlot)` — fills a relay slot `<select>` (Auto + stream01–streamN based on `maxSlots`)
- `makeRelayCard(relay)` — builds an Active Relays card with eye (preview) and stop buttons
- `toggleRelayPreview(slot, watchUrl)` — shows/hides HLS video preview using hls.js; tracks instances in `hlsInstances` Map
- `renderRelays(list)` — reconciles the `#relay-list` DOM against the current relay array (add new, remove gone)

UI patterns:
- Channel cards (search results) and Recent Activity cards are **fully clickable** — no inline buttons. Clicking opens the schedule modal or replays the stream respectively.
- All buttons use a **semi-transparent tinted style**: `rgba(color, .12)` background, vivid color text, `rgba(color, .25)` border. Green = action, blue = edit, red = delete/stop/danger.
- Square 38×38 `sched-btn` variants: `sched-btn-edit` (blue), `sched-btn-delete` (red), `sched-btn-stop` (red), `sched-btn-active` (outlined green, used for preview active state).
- Active Relay cards and Recent Activity are **separate cards** on the dashboard.
- Relay cards display: logo, stream name, `tag-time` (start time), `tag-slot` (slot name, blue tint), channel tag.

### Data files (`data/`)

| File | Contents |
|------|----------|
| `config.json` | Port, username, bcrypt password hash, session secret |
| `schedules.json` | Array of schedule objects (includes `preferredSlot`) |
| `history.json` | Last 10 playback entries |
| `settings.json` | `srsUrl`, `srsWatchUrl`, `maxSlots`, `m3uAutoRefresh`, `m3uRefreshTime` |
| `auto_scheduler.json` | Auto-scheduler config + activity log |
| `m3u_cache.json` | Persisted M3U channel list |
| `relays.json` | Persisted relay state — slot, name, url, logo, startedAt, pid (no proc) |

### Key design notes

- **FFmpeg relay** — `bin/ffmpeg.exe` re-encodes IPTV streams and pushes to SRS via RTMP. Copy mode (`-c copy`) is intentionally avoided — it fails with these IPTV sources. Re-encode args: `-c:v libx264 -preset veryfast -crf 23 -g 60 -c:a aac -b:a 128k -f flv`. Input uses `-fflags +genpts+discardcorrupt -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5`.
- **SRS dual-URL** — `srsUrl` is the RTMP push target (LAN IP, e.g. `rtmp://192.168.1.125/live`) used by FFmpeg. `srsWatchUrl` is the HTTPS base for Watch/HLS links (e.g. `https://stream.ipnoze.com/live`), served via nginx proxy. HLS stream for a slot is `srsWatchUrl/<slot>.m3u8`.
- **Relay slots** — up to 5 slots (`stream01`–`stream05`). `settings.maxSlots` (1–5, default 2) controls how many are available. Schedules and play-now support a `preferredSlot`; if the preferred slot is free and within `maxSlots`, it is used — otherwise auto-assigns the first free slot.
- **PID-based process survival** — FFmpeg PIDs are persisted to `relays.json`. On restart, live PIDs are re-adopted (no proc handle; kill via `process.kill(pid, 'SIGTERM')`). This means streams survive a Node.js crash/restart without interruption.
- **M3U cache is dual-layer** — disk (`m3u_cache.json`) loaded into `m3uMemCache` at startup; all searches run against the in-memory copy.
- **History cap is 10** — enforced in `saveHistory()`. The Recent Activity card in the UI renders only the last 5 entries.
- **Fonts** — Inter is self-hosted (`public/fonts/`, 5 woff2 files for weights 400–800, Latin subset). No Google Fonts CDN dependency.
