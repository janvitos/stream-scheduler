# StreamSched

> A self-hosted web app to schedule IPTV / stream URLs for relay via FFmpeg and SRS.

StreamSched lets you schedule any stream URL — from an M3U playlist or Xtream Codes provider — to relay automatically via FFmpeg to an SRS (Simple Realtime Server) instance at a specific time, on a recurring schedule, or instantly on demand. It supports up to 5 simultaneous relay slots, in-browser HLS preview per stream, and an auto-scheduler that can pull live sports events from an API and schedule them automatically.

---

## Features

- **M3U & Xtream Codes** — fetch and search channels from any M3U URL or Xtream Codes provider
- **One-time schedules** — relay a stream at a specific date and time, fires once then removes itself
- **Recurring schedules** — use standard cron expressions for daily, weekly, or custom intervals
- **Multi-stream relay** — up to 5 simultaneous FFmpeg relay slots (`stream01`–`stream05`), configurable in Settings
- **Preferred relay slot** — optionally pin a schedule or the auto-scheduler to a specific slot
- **In-browser HLS preview** — watch any active relay directly in the dashboard via hls.js
- **Auto-Scheduler** — automatically creates schedules from a sports API (ESPN) based on a search string; supports a default relay slot
- **Stream survival** — FFmpeg relay processes survive a Node.js restart; live PIDs are re-adopted on boot
- **Daily M3U refresh** — automatically re-fetch your channel list on a schedule
- **Playback history** — log of every stream launched with timestamps and status
- **Activity log** — tracks auto-scheduler activity, M3U refreshes, and relay errors
- **Password protected** — login required, session-based auth
- **LAN accessible** — binds to `0.0.0.0` so any device on your network can reach it

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- [FFmpeg](https://ffmpeg.org/) — place `ffmpeg.exe` in the `bin/` folder
- [SRS (Simple Realtime Server)](https://ossrs.net/) — receives RTMP from FFmpeg and serves HLS

---

## Installation

### 1. Install dependencies

Open a terminal in the `StreamSched` folder:

```bash
npm install
```

### 2. Place FFmpeg

Download a Windows FFmpeg build and place `ffmpeg.exe` in the `bin/` folder:

```
StreamSched/
  bin/
    ffmpeg.exe
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
   - **Now** — relays immediately to the next free slot
   - **Once** — pick a date and time
   - **Recurring** — enter a cron expression
3. Optionally select a **Relay Slot** to pin the stream to a specific slot (defaults to Auto)

### Active Relays (Dashboard)

- Each active relay appears as a card showing channel logo, stream name, start time, and slot
- **👁 Preview** — shows a live HLS video preview directly in the dashboard
- **■ Stop** — terminates the FFmpeg relay for that slot

### Managing Schedules (Dashboard)

- **Run Now** — trigger any schedule immediately
- **Edit** — update name, time, relay slot, or recurrence
- **Delete** — remove a schedule
- Recurring schedules show their last run time
- One-time schedules remove themselves after firing

### Cron Reference

```
┌───── minute (0–59)
│ ┌─── hour (0–23)
│ │ ┌─ day of month (1–31)
│ │ │ ┌ month (1–12)
│ │ │ │ ┌ day of week (0–7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

Examples:
```
0 20 * * 1-5    →  8:00 PM every weekday
30 18 * * 6,0   →  6:30 PM on weekends
0 */2 * * *     →  Every 2 hours
0 9 * * 1       →  Every Monday at 9:00 AM
```

### Auto-Scheduler (Settings)

The Auto-Scheduler queries a sports API on a daily schedule and automatically creates stream entries when a match is found.

1. Set a **Search String** (e.g. `Texas Tech`) to match against API results
2. Set an **API Endpoint** — defaults to the ESPN college baseball scoreboard
3. Set a **Check Time** — the time of day the scheduler will run (Eastern timezone)
4. Set a **Default Relay Slot** — optionally pin auto-created schedules to a specific relay slot
5. Optionally enable **Refresh M3U before running** to ensure channels are up to date
6. Toggle **Auto-Scheduler** on to activate

Matched events are scheduled 10 minutes before their listed start time. If the channel name includes an embedded event time, that is used instead of the API time.

### Recent Activity (Dashboard)

- Shows the last 5 streams launched — click or tap any entry to replay it instantly

---

## Relay Slots

StreamSched supports up to 5 simultaneous FFmpeg relay slots. Configure how many are available in **Settings → Max Simultaneous Streams** (1–5, default 2).

Each slot (`stream01`–`stream05`) maps to an RTMP stream pushed to SRS. When a stream is launched:

1. If a **Preferred Slot** is set and that slot is free, it is used
2. Otherwise the first available slot is auto-assigned
3. If all slots are full, the launch is rejected and logged to the Activity Log

FFmpeg relay processes run independently of the Node.js server. If the server restarts, any still-running FFmpeg processes are automatically re-adopted — streams are not interrupted.

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
| `schedules.json`      | All saved schedules (includes `preferredSlot`)    |
| `history.json`        | Playback log (last 10 entries)                    |
| `relays.json`         | Active relay state — slot, name, pid (persisted across restarts) |
| `settings.json`       | SRS URLs, max slots, M3U refresh settings         |
| `auto_scheduler.json` | Auto-scheduler config, default slot, activity log |
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
