'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Expected callback');
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    platform: process.platform,
    getWorkspace: () => ipcRenderer.invoke('workspace:get'),
    setLatexOfflineOnly: (offlineOnly) => ipcRenderer.invoke('latex-resources:set-offline', offlineOnly),
    openLatexCache: () => ipcRenderer.invoke('latex-resources:open-cache'),
    clearLatexCache: () => ipcRenderer.invoke('latex-resources:clear-cache'),
    newDocument: (kind) => ipcRenderer.invoke('document:new', kind),
    openDocuments: () => ipcRenderer.invoke('document:open'),
    updateDocument: (id, content, revision) =>
      ipcRenderer.invoke('document:update', { id, content, revision }),
    saveDocument: (id, saveAs = false) => ipcRenderer.invoke('document:save', { id, saveAs: !!saveAs }),
    closeDocument: (id) => ipcRenderer.invoke('document:close', id),
    renameDocument: (id, title) => ipcRenderer.invoke('document:rename', { id, title }),
    exportHtml: (id, html) => ipcRenderer.invoke('document:export-html', { id, html }),
    exportPdf: (id, html, engine) => ipcRenderer.invoke('document:export-pdf', { id, html, engine }),
    detach: (id, mode) => ipcRenderer.invoke('window:detach', { id, mode }),
    newProject: () => ipcRenderer.invoke('project:new'),
    openProject: () => ipcRenderer.invoke('project:open'),
    closeProject: () => ipcRenderer.invoke('project:close'),
    refreshProject: () => ipcRenderer.invoke('project:refresh'),
    openProjectFile: (rel) => ipcRenderer.invoke('project:file-open', rel),
    createProjectFile: (rel, folder = false) => ipcRenderer.invoke('project:file-create', { rel, folder }),
    importProjectFiles: () => ipcRenderer.invoke('project:file-import'),
    deleteProjectFile: (rel) => ipcRenderer.invoke('project:file-delete', { rel }),
    setMainTex: (rel) => ipcRenderer.invoke('project:set-main', rel),
    compile: (id, engine) => ipcRenderer.invoke('project:compile', { id, engine }),
    getPdf: (id) => ipcRenderer.invoke('project:get-pdf', id),
    checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
    installUpdate: () => ipcRenderer.invoke('app:install-update'),
    requestUninstall: () => ipcRenderer.invoke('app:uninstall'),
    openExternal: (url) => ipcRenderer.invoke('app:external', url),
    onWorkspace: (cb) => subscribe('workspace:changed', cb),
    onDocument: (cb) => subscribe('document:changed', cb),
    onProject: (cb) => subscribe('project:changed', cb),
    onPdfStatus: (cb) => subscribe('project:pdf-status', cb),
    onUpdateStatus: (cb) => subscribe('app:update-status', cb),
    onLatexResources: (cb) => subscribe('latex-resources:changed', cb),
  }),
);
