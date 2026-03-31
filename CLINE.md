# Stream Scheduler — Technical Reference

This document serves as the definitive technical map for the Stream Scheduler project. It provides a comprehensive overview of the project's architecture, data flow, coding standards, and getting started instructions for future developers.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Source of Truth — Data Flow & State Management](#source-of-truth)
5. [Architectural Patterns](#architectural-patterns)
6. [Coding Standards](#coding-standards)
7. [Getting Started](#getting-started)
8. [API Reference](#api-reference)
9. [Troubleshooting](#troubleshooting)

---

## Project Overview

**Stream Scheduler** is a Node.js-based application that schedules and manages live stream broadcasts using FFmpeg. It supports:

- Scheduled streams (one-time or recurring via cron expressions)
- M3U playlist parsing and channel management
- Xtream API integration for M3U sources
- Multi-stream relay management (up to 5 concurrent streams)
- Auto-scheduler for ESPN College Baseball scores
- Event streaming via Server-Sent Events (SSE)

The application runs as a single Express.js server with file-based persistence (no external database).

---

## Tech Stack

### Languages & Runtime

| Technology | Version/Notes |
|------------|---------------|
| JavaScript | ES6+ |
| Node.js | 18+ (required for Web Streams) |

### Frameworks & Libraries

| Package | Purpose |
|---------|---------|
| `express` | HTTP server and router |
| `express-session` | Session management for authentication |
| `bcryptjs` | Password hashing |
| `node-cron` | Cron job scheduling |
| `uuid` | UUID generation for IDs |

### External Dependencies

| Dependency | Purpose |
|------------|---------|
| `ffmpeg` | Stream encoding and relay publishing |
| `srs` (SRS) | RTMP streaming server (configured in settings) |

### File Storage

All data is persisted to JSON files in the `data/` directory:

| File | Purpose |
|------|---------|
| `data/config.json` | Admin credentials, port, session secret |
| `data/schedules.json` | Stream schedule definitions |
| `data/history.json` | Recent stream history (max 10 entries) |
| `data/settings.json` | FFmpeg settings, M3U refresh config |
| `data/auto_scheduler.json` | Auto-scheduler config and activity log |
| `data/relays.json` | Active relay state |
| `data/m3u_cache.json` | Cached M3U playlist data |
| `data/sessions.json` | Session store for authentication |

---

## Project Structure

```
stream-scheduler/
├── bin/                    # FFmpeg binary (optional, copied from system)
├── data/                   # Persistent data directory (created on setup)
│   ├── config.json        # Admin credentials, port, session secret
│   ├── schedules.json     # Stream schedules
│   ├── history.json       # Recent stream history
│   ├── settings.json      # FFmpeg and M3U settings
│   ├── auto_scheduler.json # Auto-scheduler config
│   ├── relays.json        # Active relay state
│   └── m3u_cache.json     # Cached M3U playlist
├── public/                 # Static assets and frontend
│   ├── index.html         # Main dashboard
│   ├── login.html         # Login page
│   ├── app.js             # Frontend JavaScript
│   ├── style.css          # Styles
│   ├── favicon-*.png      # Icons
│   └── logo.svg           # Logo
├── src/                    # Core modules
│   ├── relay-engine.js    # Stream relay management
│   ├── m3u-parser.js      # M3U playlist parser
│   └── auto-scheduler.js  # ESPN auto-scheduler logic
├── server.js              # Main Express server
├── setup.js               # Initialization script
├── start.bat              # Windows startup script
├── package.json           # Dependencies and scripts
├── README.md              # User documentation
├── LICENSE                # License file
├── .gitignore             # Git ignore rules
└── .gitattributes         # Git attributes
```

### Directory Purposes

| Directory | Purpose |
|-----------|---------|
| `bin/` | Contains FFmpeg binary (optional, can use system path) |
| `data/` | All persistent JSON data files |
| `public/` | Static files served by Express (HTML, CSS, JS) |
| `src/` | Reusable modules imported by server.js |

---

## Source of Truth — Data Flow & State Management

### Data Flow Architecture

The application uses a **file-based persistence model** with in-memory caching. All state changes are persisted to disk immediately after mutation.

```
┌─────────────────────────────────────────────────────────┐
│                    User Interaction                      │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                    Express Routes                        │
│  (GET/POST/PUT/DELETE handlers)                          │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  In-Memory State                         │
│  • relays (Map)                                          │
│  • schedules (Array)                                     │
│  • history (Array)                                       │
│  • settings (Object)                                     │
│  • autoScheduler (Object)                                │
│  • m3uMemCache (Object)                                  │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                File Persistence Layer                     │
│  • writeJSON() with write locks                          │
│  • File paths in data/ directory                         │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              External Systems                             │
│  • FFmpeg (stream relay)                                 │
│  • SRS (stream server)                                   │
│  • ESPN API (auto-scheduler)                             │
└─────────────────────────────────────────────────────────┘
```

### State Management Patterns

1. **Singleton State**: All state is global within `server.js` scope.
2. **Write Locks**: Prevents race conditions when writing JSON files.
3. **Event Streaming**: SSE endpoints push state changes to connected clients.

### Key State Objects

| State | Location | Persistence |
|-------|----------|-------------|
| `relays` | `Map` | `data/relays.json` |
| `schedules` | `Array` | `data/schedules.json` |
| `history` | `Array` | `data/history.json` |
| `settings` | `Object` | `data/settings.json` |
| `autoScheduler` | `Object` | `data/auto_scheduler.json` |
| `m3uMemCache` | `Object` | `data/m3u_cache.json` |
| `sessions` | `Object` | `data/sessions.json` |

### Data Flow Examples

#### Adding a Schedule
```
POST /api/schedules
  → schedules.push(s)
  → saveSchedules() → writes data/schedules.json
  → registerSchedule(s) → registers cron/timeout
```

#### Launching a Stream
```
POST /api/play-now
  → launchStream(s)
    → findFreeSlot()
    → spawnRelay() → FFmpeg child process
    → relays.set(slot, ...)
    → saveRelays() → writes data/relays.json
    → history.push()
    → saveHistory() → writes data/history.json
    → schedules[idx].lastRun = now
    → saveSchedules() → writes data/schedules.json
```

---

## Architectural Patterns

### 1. File-Based Persistence (NoSQL)
- All data stored as JSON files
- No external database required
- Simple CRUD operations via file I/O

### 2. Singleton Pattern
- Global state objects (`relays`, `schedules`, etc.)
- Initialized once at server startup
- Persisted to disk on every change

### 3. Factory Pattern
- `createRelayEngine()` returns an object with relay management functions
- `createSSEEndpoint()` returns middleware for SSE subscriptions

### 4. Event-Driven Architecture
- Cron jobs for scheduled tasks
- FFmpeg exit events trigger auto-restart
- SSE for real-time dashboard updates

### 5. Middleware Pattern
- Express middleware for sessions, auth, static files
- Custom middleware for SSE connections

### 6. Command-Query Responsibility Segregation (CQRS)
- GET endpoints for querying state
- POST/PUT/DELETE for mutating state

### 7. Child Process Management
- FFmpeg spawned as detached processes
- Process handles stored in `relays` Map
- Auto-restart on crash

### 8. Stream Processing
- SSE for server-to-client streaming
- M3U download streamed with progress events

---

## Coding Standards

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `relay-engine.js` |
| Functions | camelCase | `spawnRelay()` |
| Classes | PascalCase | `FileStore` |
| Constants | UPPER_SNAKE_CASE | `ALL_SLOTS` |
| Variables | camelCase | `schedules`, `relays` |
| API Routes | kebab-case in paths | `/api/schedules` |
| Query Params | kebab-case | `?url=my-stream` |

### Error Handling

- Errors logged via `console.error()` or `serverLog()`
- API errors return JSON with `error` field
- HTTP status codes: 400 (bad request), 401 (unauthorized), 404 (not found), 500 (server error)

```javascript
// Example error response
res.status(400).json({ error: 'URL required' });
```

### Async/Await Usage

- All async operations use `async/await`
- Promises used for file I/O
- Error handling with try/catch

```javascript
try {
  const data = await fs.promises.readFile(p);
} catch (e) {
  console.error(`[FS] Error reading ${p}:`, e);
}
```

### File I/O Safety

- Write locks prevent race conditions
- JSON parsing wrapped in try/catch
- File existence checked before read

```javascript
const readJSON = (p, def) => {
  try { return JSON.parse(fs.readFileSync(p)); }
  catch { return def; }
};
```

### Logging

- `serverLog()` for debug logging (controlled by `settings.debugLogging`)
- `logAutoActivity()` for auto-scheduler activity log
- Console.error() for unexpected errors

### Session Management

- File-based session store
- 90-day cookie expiration
- bcrypt for password hashing

### UUID Generation

- `uuidv4()` for all IDs (schedules, history, relays)

---

## Getting Started

### Prerequisites

- Node.js 18+ installed
- FFmpeg installed (or copied to `bin/ffmpeg.exe`)
- Git (optional, for version control)

### Installation Steps

1. **Clone or navigate to the project directory**
   ```bash
   cd stream-scheduler
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run setup to create config**
   ```bash
   node setup.js
   ```
   This will:
   - Create `data/` directory
   - Prompt for port, username, password
   - Generate `data/config.json`

4. **Start the server**
   ```bash
   node server.js
   ```
   Or use the Windows batch file:
   ```bash
   start.bat
   ```

5. **Access the dashboard**
   Open `http://localhost:3000` in your browser

### First-Time Configuration

After running `setup.js`, you'll need to:

1. Load an M3U playlist:
   - Go to the dashboard
   - Navigate to M3U section
   - Enter your M3U source URL
   - Click "Download & Parse"

2. Add schedules:
   - Click "Add Schedule"
   - Enter stream URL, name, and schedule type
   - Save

3. Configure FFmpeg:
   - Go to Settings
   - Adjust max slots, log path, etc.
   - Save

### Running Tests

No automated tests are included. Manual testing via browser is the primary verification method.

### Development Mode

Enable debug logging:
```bash
# Edit data/settings.json
{
  "debugLogging": true
}
```

### Stopping the Server

Press `Ctrl+C` in the terminal, or use:
```bash
node server.js
# Then Ctrl+C
```

### Windows Startup

Use `start.bat` for automatic Windows startup:
```bash
start.bat
```

---

## API Reference

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/login` | GET | Login page |
| `/api/auth/login` | POST | Authenticate user |
| `/api/auth/logout` | POST | Logout user |
| `/api/auth/change-password` | POST | Change password |

### Schedules

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/schedules` | GET | List all schedules |
| `/api/schedules` | POST | Create new schedule |
| `/api/schedules/:id` | PUT | Update schedule |
| `/api/schedules/:id` | DELETE | Delete schedule |

### Streams

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/play-now` | POST | Launch stream immediately |
| `/api/relays` | GET | List active relays |
| `/api/relays/:slot/stop` | POST | Stop specific relay |

### M3U Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/m3u/cache-info` | GET | Get cache info |
| `/api/m3u/use-cache` | POST | Use cached M3U |
| `/api/m3u/download` | GET | Download and parse M3U |
| `/api/m3u/search` | POST | Search channels |

### Auto-Scheduler

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auto-scheduler` | GET | Get config |
| `/api/auto-scheduler` | PUT | Update config |
| `/api/auto-scheduler/enable` | POST | Enable auto-scheduler |
| `/api/auto-scheduler/disable` | POST | Disable auto-scheduler |
| `/api/auto-scheduler/run` | POST | Run immediately |

### Settings

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings` | GET | Get settings |
| `/api/settings` | PUT | Update settings |

### System

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ping` | GET | Health check |
| `/api/system/restart` | POST | Restart service |
| `/api/proxy-image` | GET | Proxy image for CORS |

### SSE Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET | Dashboard events |
| `/api/auto-scheduler/events` | GET | Auto-scheduler events |

---

## Troubleshooting

### Common Issues

#### "config.json not found"
- Run `node setup.js` to create config

#### "No relay slots available"
- Increase `maxSlots` in settings (max 5)
- Stop existing relays first

#### FFmpeg not found
- Install FFmpeg or copy to `bin/ffmpeg.exe`

#### M3U cache not loading
- Check `data/m3u_cache.json` exists
- Verify source URL is accessible

#### Session expired
- Clear browser cookies or restart server
- Session secret in `config.json` must match

#### Auto-scheduler not running
- Check `data/auto_scheduler.json` has `enabled: true`
- Verify ESPN API endpoint is accessible

### Debug Mode

Enable verbose logging:
```json
// data/settings.json
{
  "debugLogging": true
}
```

### Log Files

FFmpeg logs are written to:
- `logs/ffmpeg-{slot}.log` (if debugLogging enabled)
- Check `data/auto_scheduler.json` for activity log

---

## Appendix

### Environment Variables

None required. All configuration is file-based.

### Security Notes

- Change default session secret in `config.json`
- Use strong passwords (bcrypt with cost 12)
- HTTPS recommended for production
- Image proxy validates URLs to prevent SSRF

### License

See `LICENSE` file.

### Contributing

1. Follow existing coding standards
2. Update this document when adding features
3. Test manually before committing

---

*Last updated: March 31, 2026*