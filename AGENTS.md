# AGENTS.md - Stream Scheduler

## Project Overview

A single-file Node.js/Express application that schedules IPTV streams using FFmpeg, served via SRS. No build system or test framework configured.

## Quick Start

```bash
# Setup initial config (run once)
node setup.js

# Start the server
node server.js
# or
npm start
```

## Build/Lint/Test Commands

There are **no build, lint, or test scripts** configured in package.json.

```bash
# To add these later, edit package.json:
{
  "scripts": {
    "start": "node server.js",
    "setup": "node setup.js",
    "lint": "eslint server.js",      # Optional: add ESLint later
    "test": "jest",                  # Optional: add Jest later
    "test:file": "jest path/to/file.test.js"  # Single test file
  },
  "devDependencies": {
    "eslint": "^8.0.0",
    "jest": "^29.0.0"
  }
}
```

Currently the app:
- Runs directly from `server.js`
- Has no unit tests
- Has no linter configuration (`.eslintrc.json` or `eslint.config.js` needed)

## Project Structure

```
stream-scheduler/
├── server.js           # Main application file
├── package.json        # Dependencies (if added later)
├── setup.js            # Config initialization script
├── data/               # JSON persistence files
│   ├── config.json     # Port, username, password hash, session secret
│   ├── schedules.json  # Scheduled streams
│   ├── history.json    # Playback history (max 10 entries)
│   ├── settings.json   # SRS URL, max slots, M3U refresh config
│   ├── relays.json     # Active relay state (slot, pid, url, logo)
│   ├── m3u_cache.json  # Parsed M3U channel list
│   └── auto_scheduler.json  # Auto-scheduler config and activity log
├── public/             # Static frontend files
│   ├── index.html      # Single-page app with vanilla JS
│   ├── login.html
│   └── fonts/          # Self-hosted Inter font files
└── bin/                # Local FFmpeg binary (ffmpeg.exe on Windows)
```

## Code Style Guidelines

### Imports

- Use `require()` with `'use strict'` at the top
- Import in grouped logical sections (config, persistence, state, middleware, routes)
- No transpiler needed; write plain ES5-compatible code

```javascript
'use strict';

const express    = require('express');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const cron       = require('node-cron');
const { spawn }   = require('child_process');
const axios      = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs         = require('fs');
const path       = require('path');
```

### Formatting

- Strict 2-space indentation
- No trailing commas (except in object literals for trailing properties)
- Maximum line length ~100 characters
- Single quotes for strings
- No semicolons at end of lines (except in `for` loops)

### Variable Naming

- `camelCase` for variables and functions
- `PascalCase` for constructors/classes
- `UPPER_SNAKE_CASE` for constants and file paths
- Prefix helpers with `build`, `parse`, `resolve`, `kill`, `spawn`, etc.
- Use `idx`, `i`, `j` for array indices
- Use `MAX`, `MIN` for constants/caps

### Type Handling

- This codebase has **no TypeScript**; use JSDoc comments if needed:
  ```javascript
  /**
   * @param {string} url
   * @returns {string}
   */
  function validateUrl(url) {
    // ...
  }
  ```

If adding TypeScript later:
- Use `npx tsc --init` for `tsconfig.json`
- Create `.d.ts` declaration files for existing functions

### Error Handling

- Use early returns for error cases
- Throw specific errors for clear failure modes:
  ```javascript
  throw new Error('No M3U source URL in cache — please load M3U manually first.');
  ```
- Log errors with context (`[AutoSched]`, `[Relay:slot]`, etc.)
- Return `{ ok: false, error: '...' }` for API failures
- Use `try/catch` for async operations with fallback logging

```javascript
try {
  const data = await axios.get(url, { timeout: 10000 });
  return data.data;
} catch (e) {
  logAutoActivity('error', `API error: ${e.message}`);
  return null;
}
```

### Async/Await

- Use `async/await` for I/O operations
- Use `Promise` for manual conversions
- Avoid `.then()` chaining; keep single chains readable

```javascript
async function refreshM3U() {
  const resp = await axios.get(url, { timeout: 120000 });
  // ...
}
```

### File I/O

- Use `readJSON` / `writeJSON` helpers for persistence
- Wrap `fs.readFileSync` in try/catch for defensive parsing
- Use `fs.promises.writeFile` for async writes

```javascript
const readJSON  = (p, def) => {
  try { return JSON.parse(fs.readFileSync(p)); }
  catch { return def; }
};
const writeJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));
```

### Node.js-specific Conventions

- Use `process.platform` for cross-platform paths
- Use `path.join()` for all file paths
- Use `path.dirname()` / `path.basename()` when needed
- Use `child_process.spawn()` with `{ detached: true }` for long-running processes

### Logging

- Use `serverLog()` function that respects `settings.debugLogging`
- Use `logAutoActivity()` for activity log entries
- Include context prefix in log messages (`[AutoSched]`, `[Relay:...]`)

```javascript
function serverLog(...args) {
  if (settings.debugLogging) console.log(...args);
}

function logAutoActivity(type, message) {
  const entry = { type, message, timestamp: new Date().toISOString() };
  autoScheduler.activityLog.unshift(entry);
  saveAutoScheduler();
  serverLog(`[AutoSched] ${message}`);
}
```

### API Routes

- Return JSON with status codes: `{ ok: true }`, `{ error: '...' }`
- Use `res.status(201)` for resource creation
- Use `res.status(404)` for "not found"
- Strip non-serializable fields (like `proc`) before persisting relays

```javascript
app.get('/api/schedules', (req, res) => res.json(schedules));

app.delete('/api/schedules/:id', (req, res) => {
  const idx = schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deleted = schedules[idx];
  // ... remove from arrays ...
  saveSchedules();
  res.json({ ok: true });
});
```

### Cron Scheduling

- Use `node-cron.validate()` to validate cron expressions
- Use `timezone` option for Eastern time scheduling

```javascript
if (!cron.validate(s.cronExpr)) return;
const job = cron.schedule(s.cronExpr, () => launchStream(s), {
  timezone: 'America/New_York'
});
```

### FFmpeg Process Handling

- Spawn with `{ detached: true }` and call `proc.unref()`
- Store PID; don't store `proc` for serialization
- Use raw `process.kill(pid, 'SIGTERM')` for detached processes
- Clean up stderr/stdout file descriptors after spawn

## Adding Features

When adding new functionality:

1. **Read existing patterns** in `server.js` to match style
2. **Update corresponding JSON files** in `data/` for persistence
3. **Add SSE broadcast** for real-time updates if needed
4. **Test manually** in browser first, then verify file persistence
5. **Add error logging** via `logAutoActivity()`

## Cursor Rules

No Cursor rules exist yet. To create `\.cursorrules`:

```
# Cursor Rules for Stream Scheduler
- Use 2-space indentation
- Keep functions under 25 lines when possible
- Log all async operations with context
- Strip non-serializable objects before JSON serialization
- Use `readJSON`/`writeJSON` for all file I/O
```

## GitHub Copilot Instructions

No Copilot instructions exist yet. To create `\.github\copilot-instructions.md`:

```
Always import modules in groups
- HTTP/framework first
- Session/auth next
- Path/file ops after
Then use helper functions readJSON/writeJSON
```

## Running a Single Test

If you add Jest later:

```bash
# All tests
npm test

# Single file
npm test -- path/to/Specific.test.js

# Single test case
npm test -- --testNamePattern="specific test name"
```

Run `npm init -y` then `npm install jest @types/node --save-dev` to configure.
