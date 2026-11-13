// Build-time only. End users do not install Tectonic or TeX Live.
// Tectonic downloads missing support files into its persistent user cache.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'vendor', 'tectonic', 'win32-x64');
const version = '0.17.0';
const executableUrl = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${version}/tectonic-${version}-x86_64-pc-windows-msvc.zip`;
const zipHash = 'f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f';
const executable = path.join(target, 'tectonic.exe');
const manifest = path.join(target, 'manifest.json');
await fsp.mkdir(target, { recursive: true });

async function digest(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
async function download(url, filename, limit) {
  if (!/^https:\/\//i.test(url)) throw new Error('Build assets must use HTTPS.');
  const response = await fetch(url, { signal: AbortSignal.timeout(25 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Download ${url}: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > limit) throw new Error('Download exceeds configured safety limit.');
  let received = 0;
  const chunks = Readable.fromWeb(response.body);
  chunks.on('data', (part) => {
    received += part.length;
    if (received > limit) chunks.destroy(new Error('Build asset exceeds size limit.'));
  });
  const tmp = filename + '.partial';
  try {
    await pipeline(chunks, fs.createWriteStream(tmp, { flags: 'w' }));
    await fsp.rename(tmp, filename);
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}
function powerShellExtract(zipPath, destination) {
  if (process.platform !== 'win32')
    throw new Error('Prepare the Windows EXE on Windows; use PowerShell to unzip the official asset.');
  const ps = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (ps.status !== 0) throw new Error(`Cannot unpack Tectonic: ${ps.stderr || ps.stdout}`);
}
function findExecutable(folder, depth = 0) {
  if (depth > 3) return null;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'tectonic.exe') return filename;
    if (entry.isDirectory()) {
      const found = findExecutable(filename, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mellowmark-tex-'));
try {
  if (!fs.existsSync(executable)) {
    const zip = path.join(tmp, 'tectonic.zip');
    console.log(`Downloading Tectonic ${version} (Windows x64) ...`);
    await download(executableUrl, zip, 200 * 1024 * 1024);
    if ((await digest(zip)) !== zipHash)
      throw new Error('Tectonic release archive SHA256 does not match the pinned checksum.');
    const extracted = path.join(tmp, 'unpacked');
    await fsp.mkdir(extracted);
    powerShellExtract(zip, extracted);
    const found = findExecutable(extracted);
    if (!found) throw new Error('Official Tectonic archive did not contain tectonic.exe.');
    await fsp.copyFile(found, executable);
  }
  const info = {
    version,
    platform: 'win32-x64',
    exeSha256: await digest(executable),
    executableSource: executableUrl,
  };
  await fsp.writeFile(manifest, JSON.stringify(info, null, 2) + '\n');
  await fsp.writeFile(
    path.join(target, 'THIRD_PARTY_NOTICES.txt'),
    'Bundled Tectonic Typesetting System (MIT license), Tectonic contributors.\n' +
      'Tectonic downloads TeX support files from its configured bundle service as needed.\n' +
      'See https://github.com/tectonic-typesetting/tectonic .\n',
  );
  console.log('Ready: Windows installer will contain Tectonic only; TeX resources download on demand.');
} finally {
  await fsp.rm(tmp, { recursive: true, force: true });
}
