'use strict';
const path = require('node:path');
const zlib = require('node:zlib');

const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_LOCATIONS = 100000;

function parseSyncTeX(bytes, workingDirectory) {
  if (bytes.length > MAX_COMPRESSED_BYTES) throw new Error('SyncTeX data exceeds 32 MB.');
  const contents = zlib.gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED_BYTES }).toString('utf8');
  const lines = contents.split(/\r?\n/);
  const inputs = new Map();
  for (const entry of lines) {
    const match = /^Input:(\d+):(.*)$/.exec(entry);
    if (match) inputs.set(Number(match[1]), match[2]);
    if (entry === 'Content:') break;
  }

  const locations = new Map();
  let page = 0;
  let inContent = false;
  for (const entry of lines) {
    if (entry === 'Content:') {
      inContent = true;
      continue;
    }
    if (!inContent) continue;
    const pageMatch = /^\{(\d+)$/.exec(entry);
    if (pageMatch) {
      page = Number(pageMatch[1]);
      continue;
    }

    const record = /^[gx](\d+),(\d+):(-?\d+),(-?\d+)/.exec(entry);
    if (!record || !page) continue;

    const [, tag, line, x, y] = record;
    const sourcePath = inputs.get(Number(tag));
    if (!sourcePath || Number(line) < 1) continue;
    const absolute = path.resolve(workingDirectory, sourcePath);
    const relative = path.relative(workingDirectory, absolute);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      continue;

    const top = Number(y);
    const bottom = top;
    const key = `${page}\0${relative}\0${line}`;
    let location = locations.get(key);
    if (!location) {
      if (locations.size >= MAX_LOCATIONS) throw new Error('SyncTeX contains too many source locations.');
      location = {
        page,
        file: relative.split(path.sep).join('/'),
        line: Number(line),
        x: Number(x),
        y: top,
        width: 0,
        height: 0,
      };
      locations.set(key, location);
      continue;
    }

    const left = Math.min(location.x, Number(x));
    const right = Math.max(location.x + location.width, Number(x));
    const unionTop = Math.min(location.y, top);
    const unionBottom = Math.max(location.y + location.height, bottom);
    location.x = left;
    location.y = unionTop;
    location.width = right - left;
    location.height = unionBottom - unionTop;
  }

  return [...locations.values()];
}

module.exports = { parseSyncTeX };
