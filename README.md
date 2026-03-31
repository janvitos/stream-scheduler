# StreamSched

<div align="center">
  <img src="public/logo.svg" alt="StreamSched Logo" width="120" height="120">
  <h3>A robust, self-hosted stream relay and scheduler for IPTV.</h3>
  <p>
    <img src="https://img.shields.io/badge/Node.js-18+-6fb43f?style=flat-square&logo=node.js" alt="Node.js">
    <img src="https://img.shields.io/badge/Architecture-Modular-00e5a0?style=flat-square" alt="Modular Architecture">
    <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
    <img src="https://img.shields.io/badge/UI-Vanilla-orange?style=flat-square" alt="Vanilla UI">
  </p>
</div>

---

**StreamSched** (stream-scheduler) is a high-performance, self-hosted web application designed to schedule and relay IPTV streams. It bridges any M3U or Xtream Codes provider to an [SRS (Simple Realtime Server)](https://ossrs.net/) instance via FFmpeg, providing a resilient, multi-slot streaming architecture with a premium user experience.

## ✨ Key Features

-   **🏗️ Modular Architecture** — Newly refactored logic split into dedicated service engines (`relay-engine`, `m3u-parser`, `auto-scheduler`) for enhanced stability and maintainability.
-   **🛡️ Resilient Relays** — FFmpeg processes are spawned **detached** from the Node.js parent. They survive server crashes and full service restarts; the engine automatically re-connects to existing processes on boot for zero-gap monitoring.
-   **⚡ High-Performance Parsing** — M3U handling has been optimized with stream-based I/O and non-blocking JSON persistence, drastically reducing memory overhead for large playlists.
-   **📅 Intelligent Auto-Scheduler** — Automatically fetches and schedules sports events via the ESPN API. Features full time-zone awareness (DST-safe) and smart channel matching.
-   **🔄 Auto-Recovery** — Built-in watchdog that detects unexpected FFmpeg exits or stream stalls and automatically re-spawns the relay after a 3-second buffer.
-   **🎨 Premium UI / UX** — A modern, glassmorphic "framed" interface built with vanilla JS/CSS. Features Inter typography, real-time SSE updates, and a responsive mobile-first layout.
-   **📡 Stream Monitoring** — Integrated Activity Log with real-time SSE event streaming, detailed per-slot FFmpeg logging (configurable), and in-browser HLS previews.
-   **🔒 Secured by Design** — Session-based authentication with Bcrypt password hashing and persistent data storage in standard JSON formats.

---

## 🛠️ Requirements

-   **Node.js v18** or later.
-   **FFmpeg** — Local binary in `bin/` or installed on your system PATH.
-   **SRS (Simple Realtime Server)** — To receive RTMP and serve HLS/WebRTC.

---

## 🚀 Quick Start

### 1. Installation
Clone the repository and install the lightweight dependencies:
```bash
npm install
```

### 2. FFmpeg Setup
Place your FFmpeg binary in a folder named `bin/` at the project root, or ensure `ffmpeg` is available in your system environment variables. StreamSched automatically detects your OS and resolves the correct path.

### 3. Configuration
Run the setup utility to initialize your credentials and ports:
```bash
node setup.js
```

### 4. Service Launch
Start the server:
```bash
node server.js
```
The application will be accessible at `http://localhost:3000` (or your configured port).

---

## 🏗️ Architecture & Engine

StreamSched is built on a **modular monolithic** pattern. While it remains a single-file server deployment for simplicity, the core logic is divided into specialized engines:

### Relay Engine (`src/relay-engine.js`)
Manages the lifecycle of FFmpeg processes. It supports up to 5 simultaneous relay slots (`stream01`–`stream05`).
-   **Detached Spawning**: Uses `spawn` with `detached: true` to decouple FFmpeg from the Node.js event loop.
-   **PID Persistence**: PIDs are saved to disk, allowing the server to re-acquire control of running streams after a restart.
-   **Force-Replacement**: Intelligently kills existing relays when a prioritized or forced stream is launched on an occupied slot.

### M3U Parser (`src/m3u-parser.js`)
An optimized parser designed for speed and low memory usage.
-   **Streamed Persistence**: Uses `fs.createWriteStream` to flush large channel caches without blocking.
-   **Dual-Layer Cache**: Keeps an in-memory searchable index while persisting the raw data to JSON for instant startup loads.

### Auto-Scheduler (`src/auto-scheduler.js`)
The "brain" of the application for automated event coverage.
-   **ESPN Integration**: Queries collegiate and professional sports APIs daily.
-   **Fuzzy Matching**: Matches API event names against your M3U channel list to find the best broadcast source.

---

## 📖 Detailed Usage Documentation

### Loading Channels (Settings → M3U / Xtream Source)

1. Paste your M3U or Xtream Codes URL — supported formats:
   - Direct `.m3u` / `.m3u8` file URL
   - Xtream Codes: `http://server/get.php?username=X&password=Y&type=m3u_plus`
2. Click **Get** to fetch and cache the channel list.
3. Optionally enable **Auto-refresh** to re-fetch daily at a time of your choosing.

### Searching & Scheduling (Dashboard)

1. Type in the **Channel Search** box to filter your channel list.
2. Click or tap any channel to open the scheduling modal:
   - **Now** — relays immediately; see slot selection behavior below.
   - **Once** — pick a specific date and time.
   - **Recurring** — choose Daily / Weekly / Monthly, set a time, and (for weekly/monthly) pick a day.
3. Optionally select a **Relay Slot** to pin the stream to a specific slot (defaults to Auto; hidden when Max Streams is set to 1).
4. After clicking **Add to Schedules**, the search input and results are cleared automatically.

### Active Relays (Dashboard)

- Each active relay appears as a card showing channel logo, stream name, start time, and slot (slot hidden when Max Streams is 1).
- **👁 Preview** — shows a live HLS video preview directly in the dashboard via hls.js.
- **■ Stop** — terminates the FFmpeg relay for that slot.
- If FFmpeg exits unexpectedly, the relay auto-restarts after 3 seconds and is logged to the Activity Log.

### Managing Schedules (Dashboard)

- **Run Now** — trigger any schedule immediately.
- **Edit** — update name, time, relay slot, or recurrence.
- **Delete** — remove a schedule immediately (no confirmation).
- Recurring schedules show a frequency badge (`DAILY` / `WEEKLY` / `MONTHLY`) and a compact time tag (e.g. `8:00 PM`, `Mon · 8:00 PM`, `1st · 8:00 PM`).
- One-time schedules remove themselves after firing.

### Activity Log (Dedicated Page)

- Shows the last 100 auto-scheduler events, M3U refresh events, relay errors, and auto-restart events.
- Updates in real time via **Server-Sent Events (SSE)**.

---

## ⚙️ Advanced Configuration

### Auto-Scheduler (Settings)

The Auto-Scheduler queries a sports API on a daily schedule and automatically creates stream entries when a match is found.

1. Set a **Search String** (e.g. `Texas Tech`) to match against API results.
2. Set an **API Endpoint** — defaults to the ESPN college baseball scoreboard.
3. Set a **Check Time** — the time of day the scheduler will run (Eastern timezone).
4. Set a **Default Relay Slot** — optionally pin auto-created schedules to a specific relay slot.
5. Optionally enable **Refresh M3U before running** to ensure channels are up to date.
6. Toggle **Auto-Scheduler** on to activate.

Matched events are scheduled 10 minutes before their listed start time. Game times are sourced exclusively from the ESPN API (UTC, converted to Eastern Time via `America/New_York`) to ensure correct DST handling year-round.

### Relay Slots

StreamSched supports up to 5 simultaneous FFmpeg relay slots. Configure how many are available in **Settings → Max Streams** (1–5, default 2). Each slot (`stream01`–`stream05`) maps to an RTMP stream pushed to SRS.

#### Slot selection behavior:
- **Max Streams = 1** — `stream01` is always used; if occupied, the current stream is stopped and replaced automatically.
- **Max Streams > 1** — a slot picker appears listing Auto and each individual slot with its current state (Free or the name of the stream playing). Choosing an occupied slot stops it first.

### Logging (Settings)

- **Debug Logging** — A single toggle that controls all optional logging.
- **FFmpeg Logs**: Writes warnings/errors to `logs/ffmpeg-<slot>.log`.
- **Log Max File Size**: Truncates files if they exceed your set limit (1–100 MB).

---

## 🖥️ Autostart on Windows (Optional)

To run StreamSched as a background Windows service that starts with the system, use [NSSM](https://nssm.cc/):

```bat
nssm install StreamSched node server.js
```

Then in the NSSM GUI:
- Set **Startup directory** to the `StreamSched` folder.
- Ensure the service name is `StreamSched` (this is required for the application's internal restart feature).

---

## 📂 Data Storage

All data is stored in the `data/` directory for easy portability:

| File                  | Contents                                          |
|-----------------------|---------------------------------------------------|
| `config.json`         | Port, username, hashed password, session secret   |
| `schedules.json`      | All saved schedules and recurrence rules          |
| `history.json`        | Playback log (last 10 entries)                    |
| `settings.json`       | SRS URLs, max slots, M3U refresh settings         |
| `auto_scheduler.json` | Auto-scheduler config and truncated activity log  |
| `m3u_cache.json`      | Cached channel list from last M3U fetch           |
| `relays.json`         | Persisted relay state (PIDs, start times, logos)  |

---

## 🔒 Security Notes

- The app binds to `0.0.0.0` and is accessible to all devices on your LAN.
- Use a strong password, especially if your LAN is shared.
- For internet access, place behind a reverse proxy (Nginx, Caddy) with HTTPS.
- Passwords are stored securely using **Bcrypt** hashing.

---

## 📜 License

Published under the **MIT License**. Created with a focus on simplicity, reliability, and performance.
