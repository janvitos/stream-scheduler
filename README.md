# StreamSched

> A self-hosted web app to schedule IPTV / stream URLs for playback via OBS Studio.

StreamSched lets you schedule any stream URL — from an M3U playlist or Xtream Codes provider — to play automatically in OBS at a specific time, on a recurring schedule, or instantly on demand. It includes an auto-scheduler that can pull live sports events from an API and schedule them automatically.

---

## Features

- **M3U & Xtream Codes** — fetch and search channels from any M3U URL or Xtream Codes provider
- **One-time schedules** — play a stream at a specific date and time, fires once then removes itself
- **Recurring schedules** — use standard cron expressions for daily, weekly, or custom intervals
- **Auto-Scheduler** — automatically creates schedules from a sports API (ESPN) based on a search string
- **OBS integration** — streams launch directly in OBS via WebSocket, supporting both Media and VLC Video source types
- **Live preview** — real-time stream preview in the browser via FFmpeg + Media Source Extensions
- **Daily M3U refresh** — automatically re-fetch your channel list on a schedule
- **Playback history** — log of every stream launched with timestamps and status
- **Activity log** — tracks auto-scheduler activity, M3U refreshes, schedule changes and service restarts
- **Password protected** — login required, session-based auth
- **LAN accessible** — binds to `0.0.0.0` so any device on your network can reach it

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- [OBS Studio](https://obsproject.com/) v28 or later (WebSocket server is built-in)
- [FFmpeg](https://ffmpeg.org/) — required for live stream preview only

---

## Installation

### 1. Install dependencies

Open a terminal in the `StreamSched` folder:

```bash
npm install
```

### 2. Run setup (first time only)

```bash
node setup.js
```

You will be prompted to enter:
- **Port** — e.g. `3000`
- **Username** — e.g. `admin`
- **Password** — minimum 6 characters

This creates `data/config.json` with your hashed credentials.

### 3. Configure OBS

In OBS Studio:
1. Go to **Tools → WebSocket Server Settings**
2. Enable the WebSocket server
3. Set the port (default: `4455`)
4. Set a password if desired (match it in StreamSched Settings)
5. Add one or both sources to your scene — a **Media Source** named exactly `Media`, a **VLC Video Source** named exactly `VLC Video`, or both. StreamSched will automatically show the active source and hide the other when a stream plays
6. In StreamSched **Settings → OBS Source**, select which source type you are using

### 4. Start the server

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
   - **Now** — plays immediately in OBS
   - **Once** — pick a date and time
   - **Recurring** — enter a cron expression

### Managing Schedules (Dashboard)

- **Run Now** — trigger any schedule immediately
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
3. Set a **Check Time** — the time of day the scheduler will run
4. Optionally enable **Refresh M3U before running** to ensure channels are up to date
5. Toggle **Auto-Scheduler** on to activate

Matched events are scheduled 10 minutes before their listed start time.

### Now Playing & Recent Activity (Dashboard)

- **Now Playing** shows the currently active stream with channel logo, name, and start time
- **Recent Activity** shows the last 10 streams played — click or tap any entry to replay it instantly

---

## Autostart on Windows (optional)

To run StreamSched as a background Windows service that starts with the system, use [NSSM](https://nssm.cc/):

```bat
nssm install StreamSched node server.js
```

Then in the NSSM GUI:
- Set **Startup directory** to the `StreamSched` folder
- Set the **Log on** account to your Windows user account (required for OBS WebSocket access)

The server will start silently at boot and restart automatically on failure.

---

## Data Files

All data is stored in the `data/` directory:

| File                 | Contents                                        |
|----------------------|-------------------------------------------------|
| `config.json`        | Port, username, hashed password                 |
| `schedules.json`     | All saved schedules                             |
| `history.json`       | Playback log (last 10 entries)                  |
| `now_playing.json`   | Currently playing stream (persisted on restart) |
| `settings.json`      | OBS connection, M3U refresh settings            |
| `auto_scheduler.json`| Auto-scheduler config and activity log          |
| `m3u_cache.json`     | Cached channel list from last M3U fetch         |

---

## Security Notes

- The app binds to `0.0.0.0` and is accessible to all devices on your LAN
- Use a strong password, especially if your LAN is shared
- For internet access, place behind a reverse proxy (nginx, Caddy) with HTTPS
- Passwords are stored hashed — never in plain text

---

## License

MIT
