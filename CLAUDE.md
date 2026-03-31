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

The backend is `server.js` with three extracted modules in `src/`. The frontend is `public/index.html` — a single-page app with all CSS and JS inline. There is no bundler or framework.

### Backend

`server.js` handles config/startup, auth, REST API, scheduler engine, SSE, and wires together the modules from `src/`:

- **`src/relay-engine.js`** — exported as a factory `createRelayEngine(context)`. Contains `findFreeSlot`, `spawnRelay`, `killRelay`, `launchStream`, auto-restart logic, and startup relay restoration. Receives shared state via the `context` object (settings getter, relay Map, FFMPEG_PATH, callbacks).
- **`src/auto-scheduler.js`** — exported as `runAutoScheduler(context)`. Hits the ESPN scoreboard API, finds games matching a search string, searches the M3U cache for a matching channel, and auto-creates a one-time schedule. ESPN UTC time is converted to Eastern via `America/New_York` (DST-aware) — M3U `eventTime` overrides are intentionally not used.
- **`src/m3u-parser.js`** — exported as `parseM3U(text)`. Parses `#EXTINF` lines into channel objects with `name`, `logo`, `group`, `id`, `eventTime`, and `url`.

Key sections of `server.js`, in order:

- **Config/persistence** — reads `data/config.json` at startup (exits if missing). All state is held in memory and flushed to JSON files in `data/` on mutation via `readJSON`/`writeJSON` helpers. `writeJSON` is serialised per-file using a promise chain (`writeLocks` Map) to avoid concurrent write corruption.
- **Auth** — session-based (`express-session`) with a custom `FileStore` that persists to `data/sessions.json`. `requireAuth` middleware gates all routes below its `app.use()` call. Password is bcrypt-hashed in `config.json`.
- **REST API** — standard CRUD for schedules (`/api/schedules`), settings (`/api/settings`), history (`/api/history`), relays (`/api/relays`), and M3U/Xtream (`/api/m3u/*`). Key endpoints: `POST /api/play-now` launches a relay immediately (accepts optional `preferredSlot` and `force` — when `force: true` and the target slot is occupied, `killRelay` is called first, followed by a 1-second pause to let SRS release the RTMP slot before the new publisher connects); `DELETE /api/relays/:slot` stops a relay. A catch-all `GET *` route at the bottom serves `index.html` for History API navigation (e.g. `/settings`).
- **Scheduler engine** — `registerSchedule`/`unregisterSchedule` manage a `cronJobs` Map. One-time schedules use `setTimeout`; recurring use `node-cron`. All enabled schedules are re-registered at startup. `buildCronFromFrequency(frequency, recurTime, recurDay)` derives a 5-field cron string from the friendly `frequency` / `recurTime` / `recurDay` fields stored on the schedule; this is called on create and edit so `cronExpr` is always kept in sync.
- **Relay engine** — `findFreeSlot(preferred)` picks the next available slot up to `settings.maxSlots`. `spawnRelay(slot, s)` spawns FFmpeg with `detached: true` + `proc.unref()` so the FFmpeg process survives NSSM stop/restart. `launchStream(s)` wraps both, sets the relay in the `relays` Map, persists state, and logs history. All FFmpeg exits are logged (null = stopped, 0 = ended unexpectedly, non-zero = crashed). The `relays` Map holds `{ slot, name, url, logo, startedAt, pid, proc }` — `proc` is stripped when serialising to disk. `resolveLogoForUrl(url, provided)` returns the provided logo or falls back to M3U cache lookup.
- **Auto-restart** — when FFmpeg exits unexpectedly (any exit where `relays.has(slot)` is still true), the relay is re-spawned after a 3-second delay. `code !== null` guards against treating a manual SIGKILL as an unexpected exit.
- **Startup relay restoration** — `relays.json` is read at boot. Alive PIDs are killed via `process.kill(pid, 'SIGTERM')` and immediately re-spawned via `spawnRelay`. Dead PIDs are discarded. Because the old PID is killed via raw OS signal (no proc handle), no exit event fires and auto-restart is not triggered.
- **SSE** — `createSSEEndpoint(clientSet)` factory creates event-stream endpoints. `broadcastSSE(clientSet, data)` pushes to all connected clients. Two endpoints: `/api/events` (dashboard) and `/api/auto-scheduler/events` (activity log). The dashboard SSE emits event types: `relays`, `schedule`, `history`.
- **Restart endpoint** — `POST /api/system/restart` calls `nssm restart StreamSched` via a detached `cmd.exe` process, so it only works when running as an NSSM service named `StreamSched`.

### Frontend (`public/index.html`)

Single HTML file with all CSS and JS inline. Navigation uses the History API (`pushState`) — clean URLs like `/settings` instead of `#settings`. An `#app-loader` overlay prevents any flash of unstyled content on page load; it is removed only after all API calls complete and fonts are ready. hls.js is loaded from CDN (`https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js`) for in-browser HLS preview.

Key utilities:
- `debounce(fn, ms)` — used for auto-save inputs
- `buildSchedulePayload(prefix, url)` — shared between New Schedule and Add Channel modals; includes `preferredSlot`. For `cron` type, reads `frequency`, `recurTime`, and `recurDay` from the sentence UI instead of a raw cron string.
- `showM3UMessage(type, text)` — unified M3U status messages
- `setToggleState(el, on)` — sets `.toggle-on` class on toggle switches
- `makeSSE(url, onMessage)` — SSE connection factory with auto-reconnect
- `GET` / `POST` / `PUT` / `DELETE` — fetch helpers
- `populateSlotDropdown(id, selectedSlot)` — fills a relay slot `<select>` (Auto + stream01–streamN based on `maxSlots`)
- `updateSlotVisibility()` — reads `maxSlots` from the DOM and hides the slot `.field` in modals (`sm-slot`, `am-slot`) when maxSlots=1; the auto-scheduler slot (`as-slot`) is always visible but disabled and greyed when maxSlots=1. Also repopulates `as-slot` options to fix a race between `loadAutoScheduler` and `loadCacheInfo` on init.
- `updateDebugLogToggle()` — sets toggle state for the `debug-log-toggle` and disables/greys `ffmpeg-log-path` and `ffmpeg-log-max-mb` inputs when debug logging is off
- `populateRecurDaySelect(prefix, frequency, selected)` — populates the day-of-week or day-of-month `<select>` in the recurrence sentence builder; hides it for `daily`
- `describeRecurrence(s)` — returns a compact time/day string for a schedule's recurrence: `"8:00 PM"` (daily), `"Mon · 8:00 PM"` (weekly), `"1st · 8:00 PM"` (monthly); falls back to raw `cronExpr` for legacy schedules
- `ordinal(n)` — returns "1st", "2nd", etc.; used by `describeRecurrence` for monthly labels
- `showRelayPicker(url, name, logo, onSuccess)` — shows the `#relay-picker-modal` listing Auto + each slot (up to `maxSlots`) with current state (Free or the playing stream name). Clicking a row calls `executeRelay(slot)` immediately. Auto is disabled when all slots are full; in that case the first slot is still clickable (force-replace).
- `executeRelay(slot)` — closes the picker modal, builds the `POST /api/play-now` payload (adding `force: true` if the chosen slot is currently occupied), fires the request, calls the optional `onSuccess` callback, then reloads history and re-renders.
- `clearChannelSearch()` — clears the M3U search input, results list, and help text; called after a successful Add to Schedules action.
- `makeRelayCard(relay)` — builds an Active Relays card with eye (preview) and stop buttons
- `toggleRelayPreview(slot, watchUrl)` — shows/hides HLS video preview using hls.js; tracks instances in `hlsInstances` Map
- `renderRelays(list)` — reconciles the `#relay-list` DOM against the current relay array (add new, remove gone)
- `renderAsLog()` — renders the Activity Log page from `asData.activityLog`

UI patterns:
- Channel cards (search results) and Recent Activity cards are **fully clickable** — no inline buttons. Clicking opens the schedule modal or triggers the relay picker (or auto-replaces when maxSlots=1) respectively.
- All buttons use a **semi-transparent tinted style**: `rgba(color, .12)` background, vivid color text, `rgba(color, .25)` border. Green = action, blue = edit, red = delete/stop/danger.
- Square 38×38 `sched-btn` variants: `sched-btn-edit` (blue), `sched-btn-delete` (red), `sched-btn-stop` (red), `sched-btn-active` (outlined green, used for preview active state).
- Active Relay cards and Recent Activity are **separate cards** on the dashboard.
- Relay cards display: logo, stream name, `tag-time` (start time), channel tag, `tag-slot` (slot name, orange tint). `tag-slot` is hidden on both relay and schedule cards when `maxSlots=1`.
- Schedule items render newest-first. The slot tag always appears when maxSlots>1 (shows "Auto" when no preferred slot is set). The schedule-type badge (`tag-sched-type`) shows `DAILY`, `WEEKLY`, or `MONTHLY` for recurring schedules (falls back to `RECURRING` for legacy cron-only entries), and `ONE-TIME` for one-off schedules.
- Recurring schedule modal uses a sentence-style builder (`recur-sentence`): frequency `<select>` → "at" → time `<input>` → optional "on" + day `<select>` for weekly/monthly. No raw cron expression field is exposed to the user.
- Delete schedule fires immediately with no confirmation dialog.
- Channel search results and Recent Activity are displayed in a **2-column grid** (`item-list--grid`); collapses to 1 column below 900px (where sidebar + 2 columns become too cramped). Activity Log also uses the 2-column grid.
- Cards do not display stream URLs — URLs are only shown in modals.
- **Framed layout** — `html` has `padding: 24px 24px 0` and a dark radial-gradient background. `body` has `border-radius: 14px 14px 0 0`, a `border: 1px solid var(--border)` ring, and layered box-shadows, giving the app a framed appearance floating above the browser background. Mobile (`≤640px`) resets the frame to edge-to-edge.

### Data files (`data/`)

| File | Contents |
|------|----------|
| `config.json` | Port, username, bcrypt password hash, session secret |
| `schedules.json` | Array of schedule objects (includes `preferredSlot`, `frequency`, `recurTime`, `recurDay`) |
| `history.json` | Last 10 playback entries |
| `settings.json` | `srsUrl`, `srsWatchUrl`, `maxSlots`, `m3uAutoRefresh`, `m3uRefreshTime`, `debugLogging`, `ffmpegLogPath`, `ffmpegLogMaxSizeMb` |
| `auto_scheduler.json` | Auto-scheduler config + activity log (capped at 100 entries) |
| `m3u_cache.json` | Persisted M3U channel list |
| `relays.json` | Persisted relay state — slot, name, url, logo, startedAt, pid (no proc) |
| `sessions.json` | Express session store (managed by `FileStore` in `server.js`) |

### Key design notes

- **FFmpeg path resolution** — at startup, `process.platform` determines the binary name (`ffmpeg.exe` on Windows, `ffmpeg` elsewhere). The local `bin/<name>` path is checked with `fs.existsSync()`; if present it is used, otherwise the bare name `ffmpeg` is passed to `spawn` so the OS resolves it from the system PATH. This allows Linux/Mac users to install FFmpeg system-wide without placing a binary in `bin/`.
- **FFmpeg relay** — re-encodes IPTV streams and pushes to SRS via RTMP. Copy mode (`-c copy`) is intentionally avoided — it fails with these IPTV sources. Full args (when logging disabled): `-re -fflags +genpts+discardcorrupt -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5 -rw_timeout 5000000 -i <url> -c:v libx264 -preset veryfast -tune zerolatency -crf 23 -g 60 -c:a aac -b:a 128k -f flv -flvflags no_duration_filesize`. When FFmpeg logging is enabled, `-loglevel warning` is prepended. `-re` is critical — IPTV sources are plain MPEG-TS over HTTP delivered in TCP bursts; without `-re`, FFmpeg consumes them faster than realtime, causing SRS to produce irregular HLS segments and the player to stall. `-flvflags no_duration_filesize` suppresses FLV header update errors on exit (irrelevant for live streams). `-rw_timeout 5000000` prevents FFmpeg hanging on a dead stream.
- **SRS dual-URL** — `srsUrl` is the RTMP push target (LAN IP, e.g. `rtmp://192.168.1.125/live`) used by FFmpeg. `srsWatchUrl` is the HTTPS base for Watch/HLS links (e.g. `https://stream.ipnoze.com/live`), served via nginx proxy. HLS stream for a slot is `srsWatchUrl/<slot>.m3u8`.
- **Relay slots** — up to 5 slots (`stream01`–`stream05`). `settings.maxSlots` (1–5, default 2) controls how many are available. Schedules and play-now support a `preferredSlot`; if the preferred slot is free and within `maxSlots`, it is used — otherwise auto-assigns the first free slot.
- **Force-replace** — `POST /api/play-now` accepts `force: true` to kill an occupied slot before launching. Used by the relay picker modal and the maxSlots=1 auto-replace path. A 1-second delay after `killRelay` prevents the new FFmpeg process from hitting SRS before it has released the previous publisher's RTMP connection.
- **PID-based process survival** — FFmpeg is spawned detached (`detached: true`, `proc.unref()`), so it is not a child of the Node.js process and is not killed when NSSM stops the service. PIDs are persisted to `relays.json`. On restart, live PIDs are killed and re-spawned to get a fresh proc handle with full crash detection. This means streams survive both a Node.js crash and a full NSSM service restart (with a brief interruption on restart for re-spawn).
- **Debug logging** — a single `settings.debugLogging` boolean controls all optional logging. When on: `serverLog()` prints to the console, and `spawnRelay()` prepends `-loglevel warning` to FFmpeg args and redirects stderr to `logs/ffmpeg-<slot>.log` via a file descriptor passed to `spawn` (no Node.js stream overhead). `-loglevel warning` filters out progress/stats noise, capturing only warnings and errors. The log file is truncated at relay start if it exceeds `settings.ffmpegLogMaxSizeMb`. Log directory defaults to `logs/` inside the app folder — safe for NSSM LocalSystem which has no access to user AppData. `console.error` is always active regardless of this setting. Defaults to off.
- **Settings defaults** — loaded via `{ ...SETTINGS_DEFAULTS, ...readJSON(SETTINGS_PATH, {}) }` so new keys are always present even on existing installs without a full file rewrite.
- **M3U cache is dual-layer** — disk (`m3u_cache.json`) loaded into `m3uMemCache` at startup; all searches run against the in-memory copy.
- **History cap is 10** — enforced in `saveHistory()`. The Recent Activity card in the UI renders the last 10 entries in a 2-column grid.
- **Activity Log cap is 100** — enforced in `logAutoActivity()` and on SSE receipt in the frontend.
- **Fonts** — Inter is self-hosted (`public/fonts/`, 5 woff2 files for weights 400–800, Latin subset). No Google Fonts CDN dependency.
