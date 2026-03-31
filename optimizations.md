# Zero-Dependency Performance Optimizations

If the absolute priority is keeping the app lightweight and avoiding any new external dependencies (like SQLite, lowdb, or frontend frameworks), we can focus strictly on native Node.js and Vanilla JS performance techniques.

Here are the highest-impact, zero-dependency optimizations to make the app significantly faster and less memory-intensive:

## 1. Non-Blocking File IO & Debouncing (Backend)
- **The Issue:** `saveSchedules()`, `saveHistory()`, etc., use synchronous `fs.writeFileSync`. Writing to disk synchronously blocks the entire Node.js event loop. If multiple users hit the API, or an automated process triggers rapid saves, your server will freeze for a fraction of a second each time.
- **The Fix:** Switch these to asynchronous `fs.promises.writeFile`. Furthermore, wrap your file save functions in a simple debounce logic so that if 10 updates occur in 100ms, it only writes to the disk once. This drastically reduces Disk I/O overhead.

## 2. Optimize M3U Memory & Event Loop (Backend)
- **The Issue:** M3U files can be huge (50MB+). Right now, the app downloads it, buffers it into a massive string, uses `JSON.stringify(m3uMemCache)` (which synchronously blocks the event loop), and writes the whole JSON file at once to disk.
- **The Fix:** 
  1. Use Node's native `readline` module or stream the M3U download directly to disk line-by-line while parsing it. This prevents buffering a massive 50MB string in V8's memory heap.
  2. Pre-compute `.searchName = name.toLowerCase()` during the initial M3U parse. When a user searches `/api/m3u/search`, the server currently maps through maybe 20,000 channels, calling `.toLowerCase()` on each one *for every keystroke*. Caching the lowercase string on the object speeds up the search filter loop enormously.
  3. When writing the `m3u_cache.json` disk cache, write it asynchronously using streams rather than a single `JSON.stringify()` serialization payload.

## 3. DOM Document Fragments (Frontend)
- **The Issue:** In `renderChannels()` and `renderDashboard()`, the code loops over arrays and calls `list.appendChild(div)` repeatedly. For the M3U search where `channels` could be hundreds of items, appending to the live DOM one-by-one causes the browser to recalculate layouts and repaints constantly.
- **The Fix:** Create a `const fragment = document.createDocumentFragment();`, append all the new rows to the fragment in memory, and then perform a single `list.appendChild(fragment)` at the end of the loop.

## 4. UI Rendering via `<template>` Tags (Frontend)
- **The Issue:** Using `innerHTML` with massive template literals inside `makeSchedItem()` forces the browser to re-parse HTML strings from scratch every time it creates an item. This also opens up potential XSS risks if `esc()` isn't used absolutely everywhere.
- **The Fix:** You don't need a framework like Alpine.js or React. Instead, put native `<template id="sched-item-template">...` tags in your `index.html`. In `app.js`, use `document.getElementById('sched-item-template').content.cloneNode(true);` and populate the `textContent` of the nodes. Cloning a parsed template is significantly faster natively for the browser than parsing full HTML strings.

## 5. View/Route Event Delegation (Frontend)
- **The Issue:** Attaching event listeners via `div.querySelectorAll('[data-action]').forEach(...)` creates thousands of individual event handler instances in memory over the lifecycle of the app, which the garbage collector has to clean up constantly.
- **The Fix:** Bind *one* single `.addEventListener('click', ...)` on the parent `#sched-list` container. When clicked, check `e.target.closest('[data-action]')` to determine what was clicked and run the function for that ID. This scales infinitely with zero added memory.

## 6. Route Splitting (Backend)
- **The Issue:** `server.js` at 900+ lines is difficult to maintain. 
- **The Fix:** You can literally just use native `require()` and `module.exports` or native Express `app.use('/api', myRouter)` to split out the Auto Scheduler, M3U parser, and API routes into separate files inside a `src/` directory without downloading any packages.
