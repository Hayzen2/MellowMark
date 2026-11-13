'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { htmlToPdf } = require('./pdf.cjs');
const Projects = require('./projects.cjs');

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const WORKSPACE_LIMIT = 25;
const EXTENSIONS = ['md', 'markdown', 'mdown', 'tex', 'txt', 'bib', 'sty', 'cls'];
const ICON = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.join(__dirname, '..', 'build', 'icon.png');
const isDev = !app.isPackaged;
const windows = new Set();
const compiled = new Map();
let primaryWindow;
let documents = [];
let project = null;
let persistTimer;
let quitting = false;
let compiling = false;
let latexSettings = { offlineOnly: false };
let updater;
let updateReady = false;
let updateStatus = {
  state: 'unconfigured',
  message: 'Configure an HTTPS release URL to enable auto-updates.',
};

function safeName(title, extension) {
  return (
    String(title || `Untitled.${extension}`)
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
      .slice(0, 140) || `Untitled.${extension}`
  );
}
function view(doc) {
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    content: doc.content,
    filePath: doc.filePath,
    dirty: doc.content !== doc.savedContent,
    revision: doc.revision,
  };
}
function allDocs() {
  return documents.map(view);
}
function broadcast(channel, data, except) {
  for (const win of windows)
    if (!win.isDestroyed() && win.webContents !== except) win.webContents.send(channel, data);
}
function workspacePath() {
  return path.join(app.getPath('userData'), 'workspace-v3.json');
}
function latexCacheDir() {
  return path.join(app.getPath('userData'), 'tectonic-cache');
}
function latexResources() {
  return { cacheDir: latexCacheDir(), offlineOnly: latexSettings.offlineOnly };
}
function loadLatexSettings() {
  try {
    const saved = JSON.parse(
      fs.readFileSync(path.join(app.getPath('userData'), 'latex-settings.json'), 'utf8'),
    );
    if (typeof saved.offlineOnly === 'boolean') latexSettings.offlineOnly = saved.offlineOnly;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load LaTeX settings:', error.message);
  }
}
function saveLatexSettings(settings) {
  const file = path.join(app.getPath('userData'), 'latex-settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(settings), 'utf8');
  fs.renameSync(file + '.tmp', file);
}
function persistWorkspace() {
  try {
    const file = workspacePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file + '.tmp',
      JSON.stringify({ documents, projectRoot: project?.root, mainFile: project?.mainFile }),
      'utf8',
    );
    fs.renameSync(file + '.tmp', file);
  } catch (err) {
    console.warn('Could not store recovery workspace:', err.message);
  }
}
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistWorkspace, 500);
}
function loadWorkspace() {
  try {
    const restoreFile = fs.existsSync(workspacePath())
      ? workspacePath()
      : path.join(app.getPath('userData'), 'workspace-v2.json');
    const value = JSON.parse(fs.readFileSync(restoreFile, 'utf8'));
    if (Array.isArray(value.documents)) {
      documents = value.documents
        .slice(0, WORKSPACE_LIMIT)
        .filter(
          (d) =>
            d &&
            typeof d.id === 'string' &&
            ['latex', 'markdown'].includes(d.kind) &&
            typeof d.content === 'string' &&
            Buffer.byteLength(d.content, 'utf8') <= MAX_DOCUMENT_BYTES,
        )
        .map((d) => ({
          id: d.id,
          title: String(d.title).slice(0, 180),
          kind: d.kind,
          content: d.content,
          savedContent: typeof d.savedContent === 'string' ? d.savedContent : '',
          filePath: typeof d.filePath === 'string' ? d.filePath : null,
          revision: Number.isSafeInteger(d.revision) ? d.revision : 0,
        }));
    }
    if (value.projectRoot) project = Projects.inspect(value.projectRoot, value.mainFile);
  } catch {
    /* Empty workspace or project moved. */
  }
}
function requireDoc(id) {
  const doc = documents.find((d) => d.id === id);
  if (!doc) throw new Error('Document not found.');
  return doc;
}
function createDoc(kind = 'markdown', content = '', title) {
  if (!['markdown', 'latex'].includes(kind)) throw new Error('Unknown document type.');
  if (documents.length >= WORKSPACE_LIMIT) throw new Error(`Limit of ${WORKSPACE_LIMIT} open tabs reached.`);
  const doc = {
    id: crypto.randomUUID(),
    kind,
    title: title || (kind === 'latex' ? 'Untitled.tex' : 'Untitled.md'),
    content,
    savedContent: content,
    filePath: null,
    revision: 0,
  };
  documents.push(doc);
  schedulePersist();
  broadcast('workspace:changed', allDocs());
  return view(doc);
}
function openFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!EXTENSIONS.includes(ext.slice(1)))
    throw new Error('Only text or LaTeX source files can open in tabs.');
  if (fs.statSync(filePath).size > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds 10 MB.');
  const found = documents.find((d) => d.filePath && path.resolve(d.filePath) === path.resolve(filePath));
  if (found) return view(found);
  const content = fs.readFileSync(filePath, 'utf8');
  const result = createDoc(
    ['.tex', '.bib', '.sty', '.cls'].includes(ext) ? 'latex' : 'markdown',
    content,
    path.basename(filePath),
  );
  const doc = requireDoc(result.id);
  doc.filePath = filePath;
  doc.savedContent = content;
  schedulePersist();
  broadcast('workspace:changed', allDocs());
  return view(doc);
}
function refreshProject() {
  if (project) {
    try {
      project = Projects.inspect(project.root, project.mainFile);
    } catch {
      project = null;
    }
  }
  schedulePersist();
  broadcast('project:changed', project);
  return project;
}
function inProject(filePath, root = project?.root) {
  return !!(root && filePath && path.resolve(filePath).startsWith(root + path.sep));
}
function cacheKey(id) {
  const doc = requireDoc(id);
  return inProject(doc.filePath) ? project.root : doc.id;
}
function invalidatePdf(doc) {
  const key = cacheKey(doc.id);
  const found = compiled.get(key);
  if (found) found.stale = true;
  broadcast('project:pdf-status', { key, stale: true });
}
function createWindow(mode = 'workspace', docId = null) {
  const win = new BrowserWindow({
    width: mode === 'workspace' ? 1550 : mode === 'split' ? 1250 : 950,
    height: mode === 'workspace' ? 950 : 800,
    minWidth: mode === 'workspace' ? 850 : 570,
    minHeight: 470,
    title: docId ? `${requireDoc(docId).title} — MellowMark` : 'MellowMark',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: true,
    backgroundColor: '#19151e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.__docId = docId;
  win.__mode = mode;
  windows.add(win);
  win.on('close', (e) => {
    if (win !== primaryWindow || quitting) return;
    const dirty = documents.filter((d) => d.content !== d.savedContent).length;
    if (!dirty) return;
    const response = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancel', 'Close (keep recovery drafts)'],
      defaultId: 0,
      cancelId: 0,
      message: `${dirty} document${dirty === 1 ? ' has' : 's have'} unsaved changes`,
      detail: 'Changes are kept in local recovery storage, but please save your work.',
    });
    if (response === 0) e.preventDefault();
  });
  win.on('closed', () => {
    windows.delete(win);
    if (win === primaryWindow) primaryWindow = null;
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const query = { mode, ...(docId ? { docId } : {}) };
  if (isDev)
    win.loadURL(
      `${process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'}/?${new URLSearchParams(query)}`,
    );
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
  return win;
}
function updateState(state, message, extra = {}) {
  updateStatus = { state, message, ...extra };
  broadcast('app:update-status', updateStatus);
}
function initializeAutoUpdate() {
  if (isDev || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;
  try {
    const { autoUpdater } = require('electron-updater');
    updater = autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => updateState('checking', 'Checking for a new version…'));
    updater.on('update-available', (info) => updateState('downloading', `Downloading ${info.version}…`));
    updater.on('update-not-available', () => updateState('current', 'Up to date.'));
    updater.on('download-progress', (p) =>
      updateState('downloading', `Downloading ${Math.round(p.percent)}%…`, { progress: p.percent }),
    );
    updater.on('update-downloaded', (info) => {
      updateReady = true;
      updateState('ready', `${info.version} is ready to install on restart.`);
    });
    updater.on('error', (err) => updateState('error', err.message));
    setTimeout(() => updater.checkForUpdates().catch((e) => updateState('error', e.message)), 5000);
    setInterval(
      () => updater.checkForUpdates().catch((e) => updateState('error', e.message)),
      6 * 60 * 60 * 1000,
    ).unref?.();
  } catch (err) {
    updateState('error', err.message);
  }
}
async function compileFor(id, engine = 'auto') {
  if (compiling) throw new Error('Compilation is already running.');
  compiling = true;
  const doc = requireDoc(id);
  let root, mainFile, temporary;
  try {
    if (inProject(doc.filePath) && project?.mainFile) {
      root = project.root;
      mainFile = project.mainFile;
    } else {
      // Standalone .tex: compile unsaved source without writing over the user's file.
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mellowmark-single-'));
      root = temporary;
      mainFile = 'main.tex';
      fs.writeFileSync(path.join(root, mainFile), doc.content, 'utf8');
    }
    const compilerConfig = {
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      resourcesPath: process.resourcesPath,
      preferBundled: true,
      cacheDir: latexCacheDir(),
      offlineOnly: latexSettings.offlineOnly,
    };
    const result = await Projects.compileLatex({
      root,
      mainFile,
      overlay: documents,
      engine,
      compilerConfig,
    });
    const key = cacheKey(id);
    if (result.ok) {
      compiled.set(key, {
        bytes: result.bytes,
        filename: result.filename,
        log: result.log,
        sourceMap: result.sourceMap,
        engine: result.engine,
        stale: false,
      });
      broadcast('project:pdf-status', { key, stale: false, ready: true });
    }
    return { ...result, key };
  } finally {
    compiling = false;
    if (temporary)
      try {
        fs.rmSync(temporary, { recursive: true, force: true });
      } catch {}
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.mellowmark.desktop');
  loadLatexSettings();
  loadWorkspace();
  if (!documents.length) createDoc();
  primaryWindow = createWindow();
  initializeAutoUpdate();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) primaryWindow = createWindow();
});
app.on('before-quit', () => {
  quitting = true;
  clearTimeout(persistTimer);
  persistWorkspace();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('workspace:get', () => ({
  documents: allDocs(),
  project,
  version: app.getVersion(),
  updateStatus,
  compilerMode: app.isPackaged && process.platform === 'win32' ? 'bundled-tectonic' : 'development',
  latexResources: latexResources(),
}));
ipcMain.handle('latex-resources:set-offline', (_, offlineOnly) => {
  if (typeof offlineOnly !== 'boolean') throw new Error('Offline-only mode must be enabled or disabled.');
  const updated = { ...latexSettings, offlineOnly };
  saveLatexSettings(updated);
  latexSettings = updated;
  const resources = latexResources();
  broadcast('latex-resources:changed', resources);
  return resources;
});
ipcMain.handle('latex-resources:open-cache', async () => {
  const cacheDir = latexCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });
  const error = await shell.openPath(cacheDir);
  if (error) throw new Error(error);
});
ipcMain.handle('latex-resources:clear-cache', async (event) => {
  if (compiling) throw new Error('Wait for LaTeX compilation to finish before clearing its cache.');
  const cacheDetail = latexSettings.offlineOnly
    ? 'Downloaded TeX packages will be removed. Offline-only mode is on, so switch it off before compiling documents that need uncached resources.'
    : 'Downloaded TeX packages will be removed. The next compilation may need an internet connection to download them again.';
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'warning',
    buttons: ['Cancel', 'Clear cache'],
    defaultId: 0,
    cancelId: 0,
    message: 'Clear cached LaTeX resources?',
    detail: cacheDetail,
  });
  if (response !== 1) return { resources: latexResources(), cleared: false };
  if (compiling) throw new Error('Wait for LaTeX compilation to finish before clearing its cache.');
  await fs.promises.rm(latexCacheDir(), { recursive: true, force: true });
  await fs.promises.mkdir(latexCacheDir(), { recursive: true });
  return { resources: latexResources(), cleared: true };
});
ipcMain.handle('document:new', (_, kind) => createDoc(kind));
ipcMain.handle('document:open', async () => {
  const picked = await dialog.showOpenDialog({
    title: 'Open documents',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown and LaTeX', extensions: EXTENSIONS }],
  });
  if (picked.canceled) return [];
  return picked.filePaths.slice(0, WORKSPACE_LIMIT).map(openFile);
});
ipcMain.handle('document:update', (event, { id, content, revision }) => {
  const doc = requireDoc(id);
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES)
    throw new Error('Document exceeds 10 MB.');
  if (revision !== doc.revision) return { conflict: true, document: view(doc) };
  if (content !== doc.content) {
    doc.content = content;
    doc.revision++;
    invalidatePdf(doc);
    schedulePersist();
    broadcast('document:changed', view(doc), event.sender);
  }
  return { conflict: false, document: view(doc) };
});
ipcMain.handle('document:save', async (_, { id, saveAs }) => {
  const doc = requireDoc(id);
  let filePath = saveAs ? null : doc.filePath;
  if (!filePath) {
    const picked = await dialog.showSaveDialog({
      title: 'Save document',
      defaultPath: safeName(doc.title, doc.kind === 'latex' ? 'tex' : 'md'),
      filters:
        doc.kind === 'latex'
          ? [{ name: 'LaTeX', extensions: ['tex', 'bib', 'sty', 'cls'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    filePath = picked.filePath;
  }
  const tmp = filePath + `.mellowmark-${process.pid}`;
  try {
    fs.writeFileSync(tmp, doc.content, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
  doc.filePath = filePath;
  doc.title = path.basename(filePath);
  doc.savedContent = doc.content;
  schedulePersist();
  refreshProject();
  broadcast('workspace:changed', allDocs());
  return view(doc);
});
ipcMain.handle('document:close', async (_, id) => {
  const doc = requireDoc(id);
  if (doc.content !== doc.savedContent) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Discard', 'Save first'],
      defaultId: 2,
      cancelId: 0,
      message: `Save changes to ${doc.title}?`,
    });
    if (response === 0) return false;
    if (response === 2) return { saveFirst: true, id };
  }
  documents = documents.filter((d) => d.id !== id);
  for (const win of windows) if (win.__docId === id && !win.isDestroyed()) win.close();
  if (!documents.length) createDoc();
  schedulePersist();
  broadcast('workspace:changed', allDocs());
  return true;
});
ipcMain.handle('document:rename', (_, { id, title }) => {
  const doc = requireDoc(id);
  if (doc.filePath) throw new Error('Use Save As to rename a file on disk.');
  doc.title = safeName(title, doc.kind === 'latex' ? 'tex' : 'md');
  schedulePersist();
  broadcast('workspace:changed', allDocs());
  return view(doc);
});
ipcMain.handle('document:export-html', async (_, { id, html }) => {
  const doc = requireDoc(id);
  if (doc.kind !== 'markdown') throw new Error('HTML export is supported for Markdown only.');
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > 16 * 1024 * 1024)
    throw new Error('HTML export too large.');
  const proposed = doc.title.replace(/\.[^.]+$/, '') + '.html';
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: safeName(proposed, 'html'),
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, html, 'utf8');
  return path.basename(filePath);
});
ipcMain.handle('document:export-pdf', async (_, { id, html, engine }) => {
  const doc = requireDoc(id);
  let bytes;
  if (doc.kind === 'markdown') {
    if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > 16 * 1024 * 1024)
      throw new Error('HTML too large to export.');
    bytes = await htmlToPdf(html);
  } else {
    let pdf = compiled.get(cacheKey(id));
    if (!pdf || pdf.stale) {
      const result = await compileFor(id, engine);
      if (!result.ok) return { error: result.error, log: result.log };
      pdf = compiled.get(cacheKey(id));
    }
    bytes = Buffer.from(pdf.bytes);
  }
  const proposed =
    doc.kind === 'latex' && inProject(doc.filePath) && project?.mainFile
      ? path.basename(project.mainFile, '.tex') + '.pdf'
      : doc.title.replace(/\.[^.]+$/, '') + '.pdf';
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: safeName(proposed, 'pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, bytes);
  return { name: path.basename(filePath) };
});
ipcMain.handle('window:detach', (_, { id, mode }) => {
  requireDoc(id);
  if (!['editor', 'preview', 'split'].includes(mode)) throw new Error('Invalid window mode.');
  const found = [...windows].find((w) => w.__docId === id && w.__mode === mode && !w.isDestroyed());
  if (found) {
    found.focus();
    return true;
  }
  createWindow(mode, id);
  return true;
});

ipcMain.handle('project:new', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Create LaTeX project folder',
    defaultPath: 'My LaTeX Project',
  });
  if (canceled || !filePath) return null;
  project = Projects.initializeNew(filePath);
  schedulePersist();
  broadcast('project:changed', project);
  const main = openFile(path.join(project.root, project.mainFile));
  return { project, document: main };
});
ipcMain.handle('project:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open LaTeX project folder',
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths[0]) return null;
  project = Projects.inspect(filePaths[0]);
  schedulePersist();
  broadcast('project:changed', project);
  const main = project.mainFile ? openFile(Projects.confined(project.root, project.mainFile)) : null;
  return { project, document: main };
});
ipcMain.handle('project:close', () => {
  project = null;
  schedulePersist();
  broadcast('project:changed', null);
  return true;
});
ipcMain.handle('project:refresh', () => refreshProject());
ipcMain.handle('project:file-open', (_, rel) => {
  if (!project) throw new Error('No project open.');
  const target = Projects.confined(project.root, rel);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('File does not exist.');
  if (Projects.TEXT_EXT.has(path.extname(target).toLowerCase())) return { document: openFile(target) };
  shell.openPath(target).catch(() => {});
  return { external: true };
});
ipcMain.handle('project:file-create', (_, { rel, folder = false }) => {
  if (!project) throw new Error('No project open.');
  if (folder) Projects.addFolder(project.root, rel);
  else Projects.addFile(project.root, rel);
  refreshProject();
  return folder ? null : openFile(Projects.confined(project.root, rel));
});
ipcMain.handle('project:file-import', async () => {
  if (!project) throw new Error('No project open.');
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Add files to LaTeX project',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'LaTeX sources and assets', extensions: [...Projects.ALLOWED_EXT].map((e) => e.slice(1)) },
    ],
  });
  if (canceled) return [];
  const added = Projects.importFiles(project.root, filePaths);
  refreshProject();
  return added;
});
ipcMain.handle('project:file-delete', async (_, { rel }) => {
  if (!project) throw new Error('No project open.');
  const target = Projects.confined(project.root, rel);
  if (
    documents.some(
      (d) =>
        d.filePath &&
        (d.filePath === target || d.filePath.startsWith(target + path.sep)) &&
        d.content !== d.savedContent,
    )
  )
    throw new Error('Save or close unsaved files before deleting them.');
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Delete permanently'],
    defaultId: 0,
    cancelId: 0,
    message: `Delete ${rel}?`,
    detail: 'This removes the file/folder from your computer, not just the project panel.',
  });
  if (response !== 1) return false;
  Projects.removeEntry(project.root, rel);
  documents = documents.filter(
    (d) => !d.filePath || !(d.filePath === target || d.filePath.startsWith(target + path.sep)),
  );
  if (!documents.length) createDoc();
  if (project.mainFile === rel) project.mainFile = null;
  refreshProject();
  broadcast('workspace:changed', allDocs());
  return true;
});
ipcMain.handle('project:set-main', (_, rel) => {
  if (!project) throw new Error('No project open.');
  if (!rel.toLowerCase().endsWith('.tex') || !fs.statSync(Projects.confined(project.root, rel)).isFile())
    throw new Error('The main file must be .tex.');
  project.mainFile = rel;
  refreshProject();
  return project;
});
ipcMain.handle('project:compile', async (_, { id, engine }) => compileFor(id, engine));
ipcMain.handle('project:get-pdf', (_, id) => {
  const item = compiled.get(cacheKey(id));
  return item ? { ...item, bytes: item.bytes } : null;
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:external', (_, url) =>
  typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url) && url.length < 2048
    ? shell.openExternal(url)
    : false,
);
ipcMain.handle('app:check-updates', async () => {
  if (!updater)
    return {
      state: 'unconfigured',
      message: 'Set MELLOWMARK_UPDATE_URL before packaging for automatic updates.',
    };
  await updater.checkForUpdates();
  return updateStatus;
});
ipcMain.handle('app:install-update', () => {
  if (!updateReady || !updater) return false;
  persistWorkspace();
  setImmediate(() => updater.quitAndInstall(false, true));
  return true;
});
ipcMain.handle('app:uninstall', async () => {
  if (process.platform !== 'win32')
    return { ok: false, reason: 'Uninstall via your system application manager.' };
  if (!app.isPackaged) return { ok: false, reason: 'Install the NSIS release before uninstalling.' };
  const file = path.join(path.dirname(process.execPath), 'Uninstall MellowMark.exe');
  if (!fs.existsSync(file))
    return { ok: false, reason: 'The NSIS uninstaller is missing. Use Installed Apps.' };
  if (documents.some((d) => d.content !== d.savedContent))
    return { ok: false, reason: 'Save unsaved documents first.' };
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Uninstall'],
    defaultId: 0,
    cancelId: 0,
    message: 'Uninstall MellowMark?',
  });
  if (response !== 1) return { ok: false, cancelled: true };
  const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  setImmediate(() => app.quit());
  return { ok: true };
});
