// src/m3u-parser.js

function parseM3U(text) {
  const channels = [];
  let meta = null;
  let start = 0;

  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      meta = { name: '', logo: '', group: '', id: '', eventTime: null };

      const nameMatch  = line.match(/,(.+)$/);
      const logoMatch  = line.match(/tvg-logo="([^"]*)"/);
      const groupMatch = line.match(/group-title="([^"]*)"/);
      const idMatch    = line.match(/tvg-id="([^"]*)"/);
      const tvgName    = line.match(/tvg-name="([^"]*)"/);

      if (logoMatch)  meta.logo  = logoMatch[1];
      if (groupMatch) meta.group = groupMatch[1];
      if (idMatch)    meta.id    = idMatch[1];

      // Use tvg-name as display name when available — it has the full "Channel | Event" string.
      // Extract ISO date before stripping it, store in eventTime for the frontend.
      const rawName = (tvgName && tvgName[1]) ? tvgName[1] : (nameMatch ? nameMatch[1].trim() : '');
      const isoMatch = rawName.match(/\((\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?\)\s*$/);
      if (isoMatch) {
         const year = parseInt(isoMatch[1].slice(0, 4), 10);
         if (year >= 2020 && year <= 2097) meta.eventTime = isoMatch[1] + 'T' + isoMatch[2];
      }
      meta.name = rawName.replace(/\s*\(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?\)\s*$/, '').replace(/\s*\|\s*$/, '').trim();
      if (!meta.name && nameMatch) meta.name = nameMatch[1].trim();

    } else if (!line.startsWith('#') && meta !== null) {
      if (!meta.name) meta.name = line;
      channels.push({ ...meta, url: line, searchName: (meta.name || '').toLowerCase() });
      meta = null;
    }
  }
  return channels;
}

module.exports = parseM3U;
