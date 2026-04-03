# StreamSched Agent Documentation

This document serves as a comprehensive guide for AI agents, detailing the architecture, functionality, and inner workings of the StreamSched project. The project is a modular monolithic application designed for high-performance IPTV stream scheduling and relay.

## 🏗️ 1. Project Overview
**Name:** StreamSched
**Description:** A robust, self-hosted web application that schedules and relays IPTV streams by bridging M3U/Xtream Codes providers to an external SRS (Simple Realtime Server) instance, managed via FFmpeg.
**Architecture Pattern:** Modular Monolithic. Core logic is partitioned into specialized, decoupled engines, even though it deploys as a single-server application.
**Technology Stack:**
*   **Runtime:** Node.js (v18+ recommended)
*   **Web Framework:** Express.js
*   **Streaming Dependencies:** FFmpeg (External Binary) and SRS (Simple Realtime Server - External Service)
*   **Language:** JavaScript
**Deployment:** Deploys as a single server process, though core logic is highly segmented.

## 🧠 2. Core Functional Engines
The application's intelligence is divided across three primary, persistent services:

### A. Relay Engine (`src/relay-engine.js`)
*   **Purpose:** Manages the execution lifecycle of stream relay processes.
*   **Mechanism:** Spawns FFmpeg processes in a **detached** manner from the main Node.js event loop. This ensures streams survive server restarts or crashes.
*   **Resilience:** Utilizes **PID Persistence** to maintain control over running streams upon service boot.
*   **Slot Management:** Supports up to 5 simultaneous relay slots (`stream01`–`stream05`).
*   **Behavior:** Automatically detects and re-acquires control of existing streams after a restart. It can aggressively kill existing relays when a higher-priority/forced stream needs an occupied slot.

### B. M3U Parser (`src/m3u-parser.js`)
*   **Purpose:** Ingesting and maintaining a fast, resilient channel cache from various playlist formats (M3U/Xtream Codes).
*   **Optimization:** Implements **Stream-based I/O** for non-blocking ingestion of very large playlists, minimizing memory footprint.
*   **Data Structure:** Employs a **Dual-Layer Cache**:
    1.  An in-memory, searchable index for fast lookups during runtime.
    2.  A persistent JSON file (`m3u_cache.json`) for near-instantaneous reload on startup.
*   **Persistence:** Uses `fs.createWriteStream` to flush data reliably.

### C. Auto-Scheduler (`src/auto-scheduler.js`)
*   **Purpose:** The proactive intelligence component that finds and schedules events automatically.
*   **Operation:** Periodically queries external sports event APIs on a daily basis.
*   **Matching Logic:** Performs **Fuzzy Matching** between API event names and the channels listed in the M3U cache to accurately map events to broadcast sources.
*   **Scheduling Rule:** Matches are automatically scheduled **10 minutes** prior to the API's listed start time.
*   **Time Zone Handling:** Strictly uses UTC from the API and converts it to **`America/New_York`** time zone to ensure correct Daylight Saving Time (DST) compliance year-round.

## 💾 3. Data Persistence Layer (`data/` directory)
All state is persisted using JSON files to ensure portability and reliable startup states.

| File Name | Contents Stored | Usage Context |
| :--- | :--- | :--- |
| `config.json` | Application secrets (Port, Session Secret, Hashes). | Primary configuration bootstrap. |
| `schedules.json` | All user-defined and auto-scheduled events/recurrences. | Dashboard/Scheduling logic state. |
| `relays.json` | State of active FFmpeg relays (PID, Slot, Stream Info). | Relay Engine monitoring and recovery. |
| `m3u_cache.json` | The complete, parsed, and indexed channel list. | M3U Parser and Channel selection. |
| `settings.json` | Global application settings (Max Streams, SRS URLs, Logging toggles). | Global configuration state. |
| `auto_scheduler.json` | Configuration and the truncated activity log from API polling. | Auto-Scheduler state. |

## ⚙️ 4. Operational Mechanics & Integration Points
*   **API Binding:** The application binds to `0.0.0.0` for LAN accessibility. Security dictates using a reverse proxy (e.g., Nginx) for public internet access.
*   **Authentication:** Session-based security managed via `bcryptjs` for password hashing and `express-session`.
*   **Streaming Output:** Relays push content to the external SRS instance, which then serves the content via protocols like HLS.
*   **Real-Time Feedback:** The UI leverages **Server-Sent Events (SSE)** for real-time updates on scheduling events, relay errors, and M3U refreshes, which are logged via the Activity Log.
*   **Control Flow:** The primary control flow is managed by `server.js`, coordinating initialization between the M3U Parser, Relay Engine, and Auto-Scheduler upon startup.

## 🧭 5. Agent Interaction Guidelines
1.  **To Inspect Stream State:** Query `relays.json` for running PID/Slot status, or monitor the Activity Log via SSE/`history.json`.
2.  **To Modify Scheduling:** Target `schedules.json` after updating channel sources in `m3u_cache.json`.
3.  **To Introduce New Features:** Logic must be contained within a new service file in `src/` or within the appropriate engine (`relay-engine`, `m3u-parser`, `auto-scheduler`) to maintain modularity.