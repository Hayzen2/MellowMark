'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function resourceDir({
  packaged = false,
  resourcesPath = process.resourcesPath,
  projectDir = path.join(__dirname, '..'),
} = {}) {
  return packaged
    ? path.join(resourcesPath, 'tex')
    : path.join(projectDir, 'vendor', 'tectonic', 'win32-x64');
}

function sha256(filename) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filename, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function resolveTectonic(options = {}) {
  const { platform = process.platform, arch = process.arch } = options;
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error('The bundled Tectonic compiler targets Windows x64 only.');
  }
  const folder = resourceDir(options);
  const exe = path.join(folder, 'tectonic.exe');
  const manifest = path.join(folder, 'manifest.json');
  for (const filename of [exe, manifest]) {
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      throw new Error(
        `The installed app is missing its bundled LaTeX compiler: ${path.basename(filename)}. Rebuild the Windows installer using npm run package:win.`,
      );
    }
  }
  const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (!/^[a-f0-9]{64}$/i.test(metadata.exeSha256 || '')) {
    throw new Error('Bundled Tectonic manifest is invalid.');
  }
  return { name: 'tectonic', exe, offlineOnly: false };
}

function verifyTectonic(options = {}) {
  const result = resolveTectonic({ platform: 'win32', arch: 'x64', ...options });
  const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(result.exe), 'manifest.json'), 'utf8'));
  if (sha256(result.exe).toLowerCase() !== meta.exeSha256.toLowerCase()) {
    throw new Error('Bundled Tectonic executable SHA256 mismatch.');
  }
  return result;
}

module.exports = { resolveTectonic, verifyTectonic, resourceDir, sha256 };
