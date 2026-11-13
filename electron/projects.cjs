'use strict';
// Disk-backed local LaTeX projects. Never follow symbolic links or accept paths
// outside the folder the user explicitly selected.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { resolveTectonic } = require('./offline-tex.cjs');
const { parseSyncTeX } = require('./synctex.cjs');

const TEXT_EXT = new Set(['.tex', '.bib', '.sty', '.cls', '.bst', '.txt', '.md', '.csv']);
const ALLOWED_EXT = new Set([...TEXT_EXT, '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg', '.webp']);
const MAX_FILES = 220;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
const MAX_PDF_BYTES = 40 * 1024 * 1024;

function relativeName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Enter a file or folder name.');
  const s = name.replace(/\\/g, '/').trim();
  const parts = s.split('/');
  if (
    path.isAbsolute(s) ||
    /^[a-zA-Z]:/.test(s) ||
    parts.some((p) => !p || p === '.' || p === '..' || /[\x00-\x1f<>:"|?*]/.test(p))
  ) {
    throw new Error('Use a relative path inside the project, without .. or special characters.');
  }
  return parts.join('/');
}
function confined(root, name) {
  const relative = relativeName(name);
  const dest = path.resolve(root, ...relative.split('/'));
  if (dest === path.resolve(root) || !dest.startsWith(path.resolve(root) + path.sep))
    throw new Error('Path must stay in the project.');
  let current = path.resolve(root);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error('Symlinks are not supported in LaTeX projects.');
  }
  return dest;
}
function scan(root) {
  const entries = [];
  let total = 0;
  function walk(dir, prefix = '', depth = 0) {
    if (depth > 8) return;
    const children = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (entries.length >= MAX_FILES) throw new Error(`Project exceeds ${MAX_FILES} entries.`);
      if (
        child.isSymbolicLink() ||
        child.name.startsWith('.') ||
        ['node_modules', 'dist', 'release', 'build', 'out'].includes(child.name)
      )
        continue;
      const rel = [prefix, child.name].filter(Boolean).join('/');
      if (child.isDirectory()) {
        entries.push({ path: rel, name: child.name, kind: 'folder' });
        walk(path.join(dir, child.name), rel, depth + 1);
      } else if (child.isFile() && ALLOWED_EXT.has(path.extname(child.name).toLowerCase())) {
        const stat = fs.statSync(path.join(dir, child.name));
        if (stat.size > MAX_FILE_BYTES) throw new Error(`${rel} exceeds the 20 MB per-file limit.`);
        total += stat.size;
        if (total > MAX_PROJECT_BYTES) throw new Error('Project exceeds the 100 MB total limit.');
        entries.push({
          path: rel,
          name: child.name,
          kind: TEXT_EXT.has(path.extname(rel).toLowerCase()) ? 'text' : 'asset',
          size: stat.size,
        });
      }
    }
  }
  walk(root);
  return entries;
}
function inspect(root, main = null) {
  if (typeof root !== 'string' || !fs.existsSync(root) || !fs.statSync(root).isDirectory())
    throw new Error('Project directory no longer exists.');
  const realRoot = fs.realpathSync(root);
  const files = scan(realRoot);
  const texFiles = files.filter((f) => f.kind === 'text' && f.name.toLowerCase().endsWith('.tex'));
  const mainFile =
    main && texFiles.some((f) => f.path === main)
      ? main
      : (texFiles.find((f) => f.path === 'main.tex') || texFiles[0])?.path || null;
  return { root: realRoot, name: path.basename(realRoot), mainFile, files };
}
function initializeNew(root) {
  if (fs.existsSync(root)) throw new Error('A file or folder already exists at that location.');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'main.tex'),
    `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{amsmath}
\\title{My LaTeX Project}
\\author{}
\\date{}
\\begin{document}
\\maketitle
\\section{Hello, MellowMark!}
Edit this file, then press \\textbf{Compile PDF}.

\\[ E = mc^2 \\]
\\end{document}
`,
    'utf8',
  );
  return inspect(root, 'main.tex');
}
function addFile(root, rel, content = '') {
  const target = confined(root, rel);
  if (!ALLOWED_EXT.has(path.extname(target).toLowerCase()))
    throw new Error('This file type cannot be added to the LaTeX project.');
  if (fs.existsSync(target)) throw new Error('That file already exists.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}
function addFolder(root, rel) {
  const target = confined(root, rel);
  if (fs.existsSync(target)) throw new Error('That folder already exists.');
  fs.mkdirSync(target, { recursive: true });
}
function uniqueImportName(root, base) {
  const parsed = path.parse(base);
  let file = base;
  let i = 2;
  while (fs.existsSync(confined(root, file))) {
    file = `${parsed.name}-${i++}${parsed.ext}`;
  }
  return file;
}
function importFiles(root, sources) {
  const added = [];
  for (const source of sources) {
    const ext = path.extname(source).toLowerCase();
    if (!ALLOWED_EXT.has(ext) || !fs.statSync(source).isFile() || fs.lstatSync(source).isSymbolicLink())
      continue;
    if (fs.statSync(source).size > MAX_FILE_BYTES)
      throw new Error(`${path.basename(source)} is larger than 20 MB.`);
    const name = uniqueImportName(root, path.basename(source));
    fs.copyFileSync(source, confined(root, name), fs.constants.COPYFILE_EXCL);
    added.push(name);
  }
  scan(root); // Verify project limits after import.
  return added;
}
function removeEntry(root, rel) {
  const target = confined(root, rel);
  if (!fs.existsSync(target)) return;
  const stats = fs.lstatSync(target);
  if (stats.isDirectory()) fs.rmSync(target, { recursive: true, force: false });
  else fs.unlinkSync(target);
}
function findOnPath(name) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const folder of paths) {
    if (!folder) continue;
    for (const ext of suffixes) {
      const test = path.join(folder, name + ext);
      try {
        if (fs.statSync(test).isFile()) return test;
      } catch {}
    }
  }
  return null;
}
function chooseEngine(choice = 'auto', compilerConfig = {}) {
  if (!['auto', 'tectonic', 'pdflatex', 'xelatex'].includes(choice)) throw new Error('Unknown TeX engine.');
  if (compilerConfig.packaged && compilerConfig.platform === 'win32') {
    return resolveTectonic(compilerConfig);
  }
  if (['auto', 'tectonic'].includes(choice) && compilerConfig.preferBundled) {
    try {
      return resolveTectonic(compilerConfig);
    } catch {}
  }
  const names = choice === 'auto' ? ['tectonic', 'pdflatex', 'xelatex'] : [choice];
  for (const name of names) {
    const exe = findOnPath(name);
    if (exe) return { exe, name };
  }
  throw new Error(
    'No development LaTeX compiler available. Run npm run prepare:tex:win on Windows for the bundled compiler, or set up a local TeX engine for development. Installed Windows releases include the compiler.',
  );
}
function runProcess(exe, args, cwd, { timeout = 300000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        TECTONIC_UNTRUSTED_MODE: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let terminated = false;
    const timer = setTimeout(() => {
      terminated = true;
      child.kill('SIGKILL');
    }, timeout);
    const append = (chunk) => {
      if (output.length < 180000) output += chunk.toString('utf8').slice(0, 180000 - output.length);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !terminated,
        log: terminated ? `${output}\nCompilation exceeded ${timeout / 1000} seconds.` : output,
      });
    });
  });
}
async function compileLatex({ root, mainFile, overlay = [], engine = 'auto', compilerConfig = {} }) {
  const { name, exe } = chooseEngine(engine, compilerConfig);
  const snapshot = inspect(root, mainFile);
  if (!snapshot.mainFile) throw new Error('This project needs a main .tex file.');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mellowmark-compile-'));
  const working = path.join(temp, 'project');
  const output = path.join(temp, 'output');
  fs.mkdirSync(working, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  try {
    // Stage only approved project entries; do not compile against mutable source files.
    for (const entry of snapshot.files) {
      const dest = confined(working, entry.path);
      if (entry.kind === 'folder') fs.mkdirSync(dest, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(confined(root, entry.path), dest);
      }
    }
    // Include edits in open tabs even when they have not been saved to disk.
    for (const item of overlay) {
      if (!item || typeof item.content !== 'string') continue;
      const sourcePath = path.resolve(item.filePath || '');
      if (!sourcePath.startsWith(root + path.sep)) continue;
      const relative = path.relative(root, sourcePath).split(path.sep).join('/');
      if (!TEXT_EXT.has(path.extname(relative).toLowerCase())) continue;
      if (Buffer.byteLength(item.content, 'utf8') > MAX_FILE_BYTES) continue;
      fs.mkdirSync(path.dirname(confined(working, relative)), { recursive: true });
      fs.writeFileSync(confined(working, relative), item.content, 'utf8');
    }
    const outputName = path.basename(snapshot.mainFile, '.tex') + '.pdf';
    const pdfPath = path.join(output, outputName);
    const syncTexPath = path.join(output, path.basename(snapshot.mainFile, '.tex') + '.synctex.gz');
    let log = '';
    let result;
    if (name === 'tectonic') {
      result = await runProcess(
        exe,
        [
          '-X',
          'compile',
          '--untrusted',
          '--keep-logs',
          '--synctex',
          ...(compilerConfig.offlineOnly ? ['--only-cached'] : []),
          '--outdir',
          output,
          snapshot.mainFile,
        ],
        working,
        { env: compilerConfig.cacheDir ? { TECTONIC_CACHE_DIR: compilerConfig.cacheDir } : {} },
      );
      log += result.log;
    } else {
      const flags = [
        '-no-shell-escape',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-file-line-error',
        '-synctex=1',
        `-output-directory=${output}`,
        snapshot.mainFile,
      ];
      result = await runProcess(exe, flags, working);
      log += result.log;
      if (result.ok) {
        const next = await runProcess(exe, flags, working);
        result = next;
        log += '\n--- Second pass ---\n' + next.log;
      }
    }
    if (!result.ok || !fs.existsSync(pdfPath)) {
      return {
        ok: false,
        engine: name,
        log: log.slice(-24000),
        error: `LaTeX compilation failed using ${name}. Read the log for the error.`,
      };
    }
    const pdf = fs.readFileSync(pdfPath);
    if (pdf.length > MAX_PDF_BYTES) throw new Error('Generated PDF exceeds 40 MB.');
    let sourceMap = [];
    let sourceMapWarning = '';
    try {
      if (!fs.existsSync(syncTexPath)) throw new Error('The compiler did not generate SyncTeX data.');
      sourceMap = parseSyncTeX(fs.readFileSync(syncTexPath), working);
    } catch (e) {
      sourceMapWarning = `\nSource navigation unavailable: ${e.message}`;
    }
    return {
      ok: true,
      engine: name,
      log: (log + sourceMapWarning).slice(-24000),
      bytes: Uint8Array.from(pdf),
      sourceMap,
      filename: outputName,
    };
  } finally {
    try {
      fs.rmSync(temp, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = {
  TEXT_EXT,
  ALLOWED_EXT,
  inspect,
  initializeNew,
  confined,
  addFile,
  addFolder,
  importFiles,
  removeEntry,
  chooseEngine,
  compileLatex,
};
