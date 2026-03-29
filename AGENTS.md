# Project Commands

## Build/Lint/Test
This project has no build step, lint, or test infrastructure configured.

| Command | Description |
|---------|-------------|
| `node server.js` | Start the server |
| `node setup.js` | Run initial setup (creates config.json) |

No test framework is configured. Adding tests would require setting up Jest/Mocha.

## Code Style Guidelines

### Import Order (server.js)
1. Core modules (const fs = require...)\n2. Third-party modules (require('express'))\n3. Custom modules\n\n### Formatting
- Use `use strict` at file top
- 2-space indentation
- Single-line imports
- Trailing commas in object literals
- No semicolons (except at end of file)

### Naming Conventions
- Variables: camelCase (schedules, history, config)\n- Constants: UPPER_SNAKE_CASE (DATA_DIR, PORT, MAX_HISTORY)\n- Functions: camelCase with descriptive names\n- Event handlers: prefix with action (loadSchedules, renderDashboard)\n\n### Error Handling
```javascript
try {
  const data = JSON.parse(fs.readFileSync(p));
} catch { return def; }
```

- Catch broad errors, log with console.error()
- Return descriptive error objects: `{ ok: false, error: '...' }`
- Use early returns for error cases
- Don't swallow errors silently

### Async/Await
- Use `async/await` for all async operations
- Handle errors with try/catch
- Return consistent shapes: `{ ok, data/error }`

### Type Safety
No TypeScript. Use JSDoc comments for complex functions:
```javascript
/**
 * @param {string} url - Stream URL
 * @returns {Promise<void>}
 */
async function processStream(url) { ...
```

### Security
- Validate all user input
- Use parameterized queries (not applicable here)
- Hash passwords with bcrypt
- Set Content-Type headers for API responses
- Limit request sizes (express.json({ limit: '10mb' }))

### File Structure
```\n- server.js (main backend)\n- public/app.js (frontend)\n- public/*.html (HTML templates)\n- setup.js (initialization)\n- data/*.json (persistence)\n- bin/ffmpeg.exe (Windows)\n```\n### Logging
- Use serverLog() for conditional logging (checks settings.debugLogging)\n- Use logAutoActivity() for auto-scheduler events\n- Use console.error() for critical errors\n- Include context in logs: `[Relay:${slot}] message`

### Cron Jobs
```javascript\nconst job = cron.schedule(expr, handler, {\n  timezone: 'America/New_York'\n});\n```\n- Always clean up cron jobs on shutdown\n- Validate cron expressions before scheduling

### API Responses
- Consistent shape: `{ ok: boolean, data?: ..., error?: string }\n- Use appropriate status codes (200, 201, 400, 401, 404, 500)\n- Return 401 for unauthorized API requests\n- Redirect /login for protected routes

### State Management
- Keep in-memory state in Maps where appropriate\n- Persist all state changes to JSON files\n- Strip non-serializable properties before disk write
- Trim activity logs to 100 entries

### Event Streams (SSE)\n- Create endpoints with createSSEEndpoint()\n- Add heartbeat every 30s: `: ping\n\n`\n- Clean up connections on close/error
- Cap client logs at 100 entries

## Best Practices

1. **Slots Management**: \n   - ALL_SLOTS = ['stream01'...'stream05']\n   - Find free slot with findFreeSlot(preferred)\n   - Kill relay before reusing\n   - Wait 1s after kill for SRS to release\n\n2. **M3U Parsing**:\n   - Parse line by line\n   - Extract meta from #EXTINF\n   - Use tvg-name for display, fall back to name\n   - Extract date from tvg-name if present\n\n3. **Relay Restart**:\n   - Auto-restart on unexpected exit after 3s\n   - Kill old FFmpeg on startup, re-spawn with fresh proc handle\n   - Log clear/stale relay events\n\n4. **Auto-Scheduler**:\n   - Run daily at configured time (Eastern timezone)\n   - Fetch ESPN scoreboard API\n   - Match games by search string\n   - Find M3U channel by name/date\n   - Create one-time schedule\n\n## Rules Reference

See the following files for additional guidelines:\n\n- `.cursor/rules/*` - Cursor-specific rules (if present)\n- `.cursorrules` - Cursor global rules (if present)\n- `.github/copilot-instructions.md` - Copilot rules (if present)\n\n## Environment Variables

None required. Configuration is stored in `data/config.json`:\n- port\n- username\n- passwordHash\n- sessionSecret\n\n## Default Settings

See `SETTINGS_DEFAULTS` in server.js:\n- srsUrl: RTMP push target\n- srsWatchUrl: HLS watch URL\n- maxSlots: 1-5 (default 2)\n- debugLogging: false\n- ffmpegLogPath: logs/\n- ffmpegLogMaxSizeMb: 10\n\n## FFmpeg Args

```bash\n-re -fflags +genpts+discardcorrupt \\n-reconnect 1 -reconnect_at_eof 1 \\n-reconnect_streamed 1 -reconnect_delay_max 5 \\n-rw_timeout 5000000 \\n-i <url> \\n-c:v libx264 -preset veryfast -tune zerolatency \\n-crf 23 -g 60 \\n-c:a aac -b:a 128k \\n-f flv -flvflags no_duration_filesize \\n<outputUrl>\n```\n\nAdd `-loglevel warning` when debug logging is enabled.\n