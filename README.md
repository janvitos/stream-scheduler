# StreamSched

> A self-hosted web app to schedule IPTV / stream URLs for relay via FFmpeg and SRS.

StreamSched lets you schedule any stream URL — from an M3U playlist or Xtream Codes provider — to relay automatically via FFmpeg to an SRS (Simple Realtime Server) instance at a specific time, on a recurring schedule, or instantly on demand. It supports up to 5 simultaneous relay slots, in-browser HLS preview per stream, and an auto-scheduler that can pull live sports events from an API and schedule them automatically.

---

## Features

- **M3U & Xtream Codes** — fetch and search channels from any M3U URL or Xtream Codes provider
- **One-time schedules** — relay a stream at a specific date and time, fires once then removes itself
- **Recurring schedules** — schedule daily, weekly, or monthly recurrences via a simple time/day picker
- **Multi-stream relay** — up to 5 simultaneous FFmpeg relay slots (`stream01`–`stream05`), configurable in Settings
- **Preferred relay slot** — optionally pin a schedule or the auto-scheduler to a specific slot
- **Relay slot picker** — when launching immediately with multiple slots available, a picker modal shows the state of each slot; with a single slot configured, the current stream is replaced automatically
- **In-browser HLS preview** — watch any active relay directly in the dashboard via hls.js
- **Auto-Scheduler** — automatically creates schedules from a sports API (ESPN) based on a search string; supports a default relay slot
- **FFmpeg auto-restart** — if FFmpeg exits unexpectedly (any exit not triggered by the Stop button), the relay automatically re-spawns after a 3-second delay
- **Stream survival** — FFmpeg relay processes are detached from Node.js and survive both a Node.js crash and a full NSSM service restart; live processes are re-spawned on boot for full crash detection
- **Cross-platform FFmpeg** — uses `bin/ffmpeg` if present, otherwise falls back to `ffmpeg` on the system PATH; Windows uses `ffmpeg.exe` automatically
- **FFmpeg logging** — optional per-slot log files capturing warnings and errors; configurable directory and max file size
- **Console logging** — toggle server-side console output on or off (useful when running as a background service)
- **Daily M3U refresh** — automatically re-fetch your channel list on a schedule
- **Playback history** — log of every stream launched with timestamps and status
- **Activity log** — dedicated page tracking auto-scheduler activity, M3U refreshes, relay errors, and auto-restart events (last 100 entries)
- **Password protected** — login required, session-based auth
- **LAN accessible** — binds to `0.0.0.0` so any device on your network can reach it

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- [FFmpeg](https://ffmpeg.org/) — place in `bin/` or install system-wide
- [SRS (Simple Realtime Server)](https://ossrs.net/) — receives RTMP from FFmpeg and serves HLS

---

## Installation

### 1. Install dependencies

Open a terminal in the `StreamSched` folder:

```bash
npm install
```

### 2. Place FFmpeg

StreamSched looks for FFmpeg in the following order:

1. `bin/ffmpeg.exe` (Windows) or `bin/ffmpeg` (Linux/Mac) — local binary inside the app folder
2. `ffmpeg` on the system PATH — if no local binary is found

**Option A — Local binary (all platforms):**
```
StreamSched/
  bin/
    ffmpeg.exe   ← Windows
    ffmpeg       ← Linux / Mac
```

**Option B — System-wide (Linux/Mac):**
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

### 3. Run setup (first time only)

```bash
node setup.js
```

You will be prompted to enter:
- **Port** — e.g. `3000`
- **Username** — e.g. `admin`
- **Password** — minimum 6 characters

This creates `data/config.json` with your hashed credentials.

### 4. Configure SRS

StreamSched pushes RTMP to SRS and reads HLS back. Two URLs need to be set in **Settings → Stream Relay**:

| Setting | Description | Example |
|---------|-------------|---------|
| **SRS RTMP URL** | RTMP ingest endpoint used by FFmpeg (LAN IP) | `rtmp://192.168.1.125/live` |
| **SRS Watch URL** | HTTPS base URL for HLS playback (your domain/proxy) | `https://stream.example.com/live` |

HLS for each slot is served at `{SRS Watch URL}/{slot}.m3u8` — e.g. `https://stream.example.com/live/stream01.m3u8`.

**Recommended `srs.conf`:**

```nginx
listen              1935;
max_connections     1000;
srs_log_tank        console;

http_server {
    enabled         on;
    listen          8080;
    dir             ./objs/nginx/html;
}

vhost __defaultVhost__ {
    publish {
        firstpkt_timeout    20000;  # ms — wait for first packet
        normal_timeout      30000;  # ms — tolerance for gaps in IPTV streams (default 5000 is too aggressive)
    }

    hls {
        enabled         on;
        hls_path        ./objs/nginx/html;
        hls_fragment    1;
        hls_window      6;          # seconds of HLS buffer — 6 is a good balance for live sports
        hls_dispose     10;
    }
}
```

The `normal_timeout` increase is important — IPTV streams can have brief gaps that the default 5-second timeout treats as a dead connection, killing the relay. The `hls_window 6` gives the browser player enough buffer to absorb minor hiccups without stalling.

### 5. Start the server

```bash
node server.js
```

Open your browser to `http://localhost:3000` (or your chosen port).

To access from another device on your LAN, use your machine's local IP:
```
http://192.168.1.x:3000
```

---

## Usage

### Loading Channels (Settings → M3U / Xtream Source)

1. Paste your M3U or Xtream Codes URL — supported formats:
   - Direct `.m3u` / `.m3u8` file URL
   - Xtream Codes: `http://server/get.php?username=X&password=Y&type=m3u_plus`
2. Click **Get** to fetch and cache the channel list
3. Optionally enable **Auto-refresh** to re-fetch daily at a time of your choosing

### Searching & Scheduling Channels (Dashboard)

1. Type in the **Channel Search** box to filter your channel list
2. Click or tap any channel to open the scheduling modal:
   - **Now** — relays immediately; see slot selection behaviour below
   - **Once** — pick a date and time
   - **Recurring** — choose Daily / Weekly / Monthly, set a time, and (for weekly/monthly) pick a day
3. Optionally select a **Relay Slot** to pin the stream to a specific slot (defaults to Auto; hidden when Max Streams is set to 1)
4. After clicking **Add to Schedules**, the search input and results are cleared automatically

### Active Relays (Dashboard)

- Each active relay appears as a card showing channel logo, stream name, start time, and slot (slot hidden when Max Streams is 1)
- **👁 Preview** — shows a live HLS video preview directly in the dashboard
- **■ Stop** — terminates the FFmpeg relay for that slot
- If FFmpeg exits unexpectedly, the relay auto-restarts after 3 seconds and is logged to the Activity Log

### Managing Schedules (Dashboard)

- **Run Now** — trigger any schedule immediately
- **Edit** — update name, time, relay slot, or recurrence
- **Delete** — remove a schedule immediately (no confirmation)
- Recurring schedules show a frequency badge (`DAILY` / `WEEKLY` / `MONTHLY`) and a compact time tag (e.g. `8:00 PM`, `Mon · 8:00 PM`, `1st · 8:00 PM`)
- One-time schedules remove themselves after firing
- Schedules are listed newest-first; slot badge shown when Max Streams > 1 (displays "Auto" if no preferred slot is set)

### Activity Log (dedicated page)

- Shows the last 100 auto-scheduler events, M3U refresh events, relay errors, and auto-restart events
- Updates in real time via SSE

### Auto-Scheduler (Settings)

The Auto-Scheduler queries a sports API on a daily schedule and automatically creates stream entries when a match is found.

1. Set a **Search String** (e.g. `Texas Tech`) to match against API results
2. Set an **API Endpoint** — defaults to the ESPN college baseball scoreboard
3. Set a **Check Time** — the time of day the scheduler will run (Eastern timezone)
4. Set a **Default Relay Slot** — optionally pin auto-created schedules to a specific relay slot
5. Optionally enable **Refresh M3U before running** to ensure channels are up to date
6. Toggle **Auto-Scheduler** on to activate

Matched events are scheduled 10 minutes before their ESPN-listed start time. Game times are sourced exclusively from the ESPN API (UTC, converted to Eastern Time via `America/New_York`) to ensure correct DST handling year-round.

### Logging (Settings)

- **FFmpeg Logging** — when enabled, each relay slot writes warnings and errors to `logs/ffmpeg-<slot>.log` inside the StreamSched folder. Configure the log directory and max file size (1–100 MB; file is truncated at relay start if the limit is exceeded). Defaults to off.
- **Console Logging** — toggles server-side `console.log` output. Useful to enable when running `node server.js` directly for debugging; leave off when running as an NSSM service. `console.error` is always active regardless of this setting. Defaults to off.

### Recent Activity (Dashboard)

- Shows the last 10 streams launched in a 2-column grid — click or tap any entry to replay it instantly using the same slot selection behaviour described below

---

## Relay Slots

StreamSched supports up to 5 simultaneous FFmpeg relay slots. Configure how many are available in **Settings → Max Streams** (1–5, default 2).

Each slot (`stream01`–`stream05`) maps to an RTMP stream pushed to SRS.

### Slot selection when launching immediately

Launching immediately (Recent Activity card, Schedule "Run Now", or "Now" in the schedule/channel modal) uses one of two paths depending on **Max Streams**:

- **Max Streams = 1** — stream01 is always used; if it is already occupied the current stream is stopped and replaced automatically.
- **Max Streams > 1** — a slot picker appears listing Auto and each individual slot with its current state (Free or the name of the stream playing). Clicking a row launches immediately. Choosing an occupied slot stops it first. Auto is disabled when all slots are full, but individual slots remain selectable for forced replacement.

### Scheduled streams

Scheduled streams use the optional **Preferred Slot** set on the schedule:

1. If a preferred slot is set and free, it is used
2. Otherwise the first available slot is auto-assigned
3. If all slots are full, the launch is rejected and logged to the Activity Log

FFmpeg processes are spawned detached from Node.js, so they are not killed when the service stops or restarts. If the server restarts, any still-running FFmpeg processes are killed and immediately re-spawned — this causes a brief stream interruption but ensures full crash detection (exit codes, activity log) going forward. If FFmpeg exits unexpectedly at any time, it is automatically re-spawned after a 3-second delay.

---

## Autostart on Windows (optional)

To run StreamSched as a background Windows service that starts with the system, use [NSSM](https://nssm.cc/):

```bat
nssm install StreamSched node server.js
```

Then in the NSSM GUI:
- Set **Startup directory** to the `StreamSched` folder

The server will start silently at boot and restart automatically on failure.

---

## Data Files

All data is stored in the `data/` directory:

| File                  | Contents                                          |
|-----------------------|---------------------------------------------------|
| `config.json`         | Port, username, hashed password                   |
| `schedules.json`      | All saved schedules (includes `preferredSlot`, `frequency`, `recurTime`, `recurDay`) |
| `history.json`        | Playback log (last 10 entries)                    |
| `relays.json`         | Active relay state — slot, name, pid (persisted across restarts) |
| `settings.json`       | SRS URLs, max slots, M3U refresh settings, FFmpeg logging config, console logging toggle |
| `auto_scheduler.json` | Auto-scheduler config, default slot, activity log (last 100 entries) |
| `m3u_cache.json`      | Cached channel list from last M3U fetch           |

---

## Security Notes

- The app binds to `0.0.0.0` and is accessible to all devices on your LAN
- Use a strong password, especially if your LAN is shared
- For internet access, place behind a reverse proxy (nginx, Caddy) with HTTPS
- Passwords are stored hashed — never in plain text

---

## License

MIT
