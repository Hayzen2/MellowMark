<script setup>
import { computed, ref, shallowRef, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import {
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  Code2,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  File,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Keyboard,
  List,
  Maximize2,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sigma,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
  WandSparkles,
} from 'lucide-vue-next';
import PdfPreview from './components/PdfPreview.vue';
import { createHtmlExport, renderMarkdownWithSource } from './render.js';
import { formatMarkdown } from './markdown-format.js';
import { createEditorHistory } from './editor-history.mjs';

const desktop = window.desktop;
const logoUrl = `${import.meta.env.BASE_URL}logo.png`;
const normalizedPath = (p) => String(p || '').replaceAll('\\', '/');
const params = new URLSearchParams(location.search);
const detached = ['editor', 'preview', 'split'].includes(params.get('mode'));
const initialMode = detached ? params.get('mode') : localStorage.getItem('mm:mode') || 'split';
const docs = ref([]),
  project = ref(null),
  activeId = ref(null),
  mode = ref(initialMode);
const theme = ref(localStorage.getItem('mm:theme') === 'light' ? 'light' : 'dark');
const sidebar = ref(localStorage.getItem('mm:sidebar') !== 'off');
const paneWidth = ref(Number(localStorage.getItem('mm:split')) || 50);
const engine = ref(localStorage.getItem('mm:engine') || 'auto');
const busy = ref(false),
  compiling = ref(false),
  showSettings = ref(false),
  showCreate = ref(false);
const fileDialog = ref(null),
  newEntryName = ref(''),
  fileDialogError = ref(''),
  fileDialogInput = ref(null);
const compilerMode = ref('development');
const toast = ref(''),
  conflict = ref(null),
  showLog = ref(false),
  compileLog = ref('');
const updateStatus = ref({ state: 'unconfigured', message: '' });
const latexResources = ref({ cacheDir: '', offlineOnly: false });
const pdfBytes = shallowRef(null),
  pdfSourceMap = shallowRef([]),
  pdfStale = ref(false),
  pdfError = ref('');
const editorEl = ref(null),
  paneEl = ref(null);
const pending = new Map();
const editorHistory = createEditorHistory();
const editorInputBefore = new Map();
let resizeCleanup = null,
  noticeTimer = null,
  unsub = [],
  previewToken = 0;
const activeDoc = computed(() => docs.value.find((d) => d.id === activeId.value) || null);
const singlePaneWindow = computed(() => detached && mode.value !== 'split');
const isLatex = computed(() => activeDoc.value?.kind === 'latex');
const previewHtml = computed(() =>
  isLatex.value ? '' : renderMarkdownWithSource(activeDoc.value?.content || ''),
);
const count = computed(() => {
  const v = activeDoc.value?.content || '';
  return { lines: v.split('\n').length, words: v.trim().match(/\S+/g)?.length || 0, chars: v.length };
});
const projectFile = computed(
  () =>
    !!(
      activeDoc.value?.filePath &&
      project.value?.root &&
      normalizedPath(activeDoc.value.filePath).startsWith(normalizedPath(project.value.root) + '/')
    ),
);
const docLanguage = computed(() => (isLatex.value ? 'LaTeX' : 'Markdown'));
const formatItems = computed(() =>
  isLatex.value
    ? [
        { label: 'Section', icon: '§', before: '\\section{', after: '}', fallback: 'Section' },
        { label: 'Bold', icon: 'B', before: '\\textbf{', after: '}', fallback: 'text' },
        { label: 'Math', icon: '∑', before: '\\[\n', after: '\n\\]', fallback: 'E = mc^2' },
        {
          label: 'Item',
          icon: '•',
          before: '\\begin{itemize}\n  \\item ',
          after: '\n\\end{itemize}',
          fallback: 'Item',
        },
        {
          label: 'Image',
          icon: '▧',
          before: '\\includegraphics[width=0.8\\linewidth]{',
          after: '}',
          fallback: 'image.png',
        },
      ]
    : [
        { label: 'Heading', icon: 'H1', before: '# ', after: '', fallback: 'Heading' },
        { label: 'Bold', icon: 'B', before: '**', after: '**', fallback: 'bold' },
        { label: 'Italic', icon: 'I', before: '*', after: '*', fallback: 'italic' },
        { label: 'Code', icon: '</>', before: '```js\n', after: '\n```', fallback: 'code' },
        { label: 'List', icon: '•', before: '- ', after: '', fallback: 'Item' },
        { label: 'Math', icon: '∑', before: '$$\n', after: '\n$$', fallback: 'E = mc^2' },
      ],
);

function announce(message) {
  toast.value = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (toast.value = ''), 4200);
}
function localDoc(id) {
  return docs.value.find((d) => d.id === id);
}
function syncDocs(incoming) {
  if (!Array.isArray(incoming)) return;
  docs.value = incoming.map((remote) => {
    const local = localDoc(remote.id);
    if (local && pending.get(remote.id)?.hasPending)
      return { ...remote, content: local.content, dirty: true, revision: local.revision };
    return remote;
  });
  if (!docs.value.find((d) => d.id === activeId.value)) activeId.value = docs.value[0]?.id || null;
}
function scrollEditorToOffset(editor, offset) {
  const computed = getComputedStyle(editor);
  const mirror = document.createElement('div');
  const marker = document.createElement('span');
  Object.assign(mirror.style, {
    position: 'fixed',
    top: '-100000px',
    left: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    boxSizing: 'border-box',
    width: `${editor.clientWidth}px`,
    height: 'auto',
    minHeight: '0',
    maxHeight: 'none',
    overflow: 'visible',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: computed.wordBreak,
    font: computed.font,
    letterSpacing: computed.letterSpacing,
    textIndent: computed.textIndent,
    textTransform: computed.textTransform,
    lineHeight: computed.lineHeight,
    tabSize: computed.tabSize,
    padding: computed.padding,
    border: computed.border,
  });
  mirror.textContent = editor.value.slice(0, offset);
  Object.assign(marker.style, { display: 'inline-block', width: '1px', height: '1em' });
  mirror.append(marker);
  document.body.append(mirror);
  const targetTop = marker.offsetTop;
  mirror.remove();
  editor.scrollTop = Math.max(0, targetTop - editor.clientHeight / 3);
}
function receiveDoc(remote) {
  const local = localDoc(remote.id);
  if (!local) return;
  if (pending.get(remote.id)?.hasPending) {
    if (local.content !== remote.content)
      conflict.value = { id: remote.id, mine: local.content, other: remote };
    return;
  }
  Object.assign(local, remote);
}
async function sendEdits(id) {
  const queue = pending.get(id);
  if (!queue || queue.sending) return;
  queue.sending = true;
  try {
    while (queue.hasPending) {
      queue.hasPending = false;
      const snapshot = queue.latest;
      const doc = localDoc(id);
      if (!doc) return;
      const result = await desktop.updateDocument(id, snapshot, doc.revision);
      if (result.conflict) {
        conflict.value = { id, mine: queue.latest, other: result.document };
        queue.hasPending = false;
        return;
      }
      doc.revision = result.document.revision;
      doc.dirty = result.document.dirty || doc.content !== snapshot;
      if (queue.latest !== snapshot) queue.hasPending = true;
    }
  } catch (e) {
    announce(e.message || 'Could not sync edits');
  } finally {
    queue.sending = false;
  }
}
function setText(content) {
  const doc = activeDoc.value;
  if (!doc || typeof content !== 'string') return;
  doc.content = content;
  doc.dirty = true;
  let q = pending.get(doc.id);
  if (!q) {
    q = { latest: content, hasPending: false, sending: false };
    pending.set(doc.id, q);
  }
  q.latest = content;
  q.hasPending = true;
  void sendEdits(doc.id);
  if (isLatex.value && pdfBytes.value) pdfStale.value = true;
}
function selectionState(editor, content = editor.value) {
  return {
    content,
    selectionStart: Math.min(editor.selectionStart, content.length),
    selectionEnd: Math.min(editor.selectionEnd, content.length),
  };
}
function captureEditorInput(event) {
  const doc = activeDoc.value;
  if (!doc) return;
  editorInputBefore.set(doc.id, selectionState(event.target));
}
function updateEditorText(event) {
  const doc = activeDoc.value;
  if (!doc) return;
  const editor = event.target;
  const before = editorInputBefore.get(doc.id) || {
    content: doc.content,
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
  };
  editorInputBefore.delete(doc.id);
  const after = selectionState(editor);
  editorHistory.record(doc.id, before, after, event.inputType || 'edit');
  setText(after.content);
}
function changeEditorText(content, inputType) {
  const doc = activeDoc.value;
  const editor = editorEl.value;
  if (!doc || !editor || content === doc.content) return;
  const before = selectionState(editor, doc.content);
  const after = { content, selectionStart: before.selectionStart, selectionEnd: before.selectionEnd };
  editorHistory.record(doc.id, before, after, inputType);
  setText(content);
}
function applyEditorHistory(direction) {
  const doc = activeDoc.value;
  const editor = editorEl.value;
  if (!doc || !editor) return;
  const current = selectionState(editor);
  const target = editorHistory[direction](doc.id, current);
  if (!target) return;
  editorInputBefore.delete(doc.id);
  editor.value = target.content;
  editor.setSelectionRange(target.selectionStart, target.selectionEnd);
  setText(target.content);
  editor.focus();
}
function resolveConflict(keepMine) {
  const c = conflict.value;
  if (!c) return;
  const doc = localDoc(c.id);
  if (doc) Object.assign(doc, c.other);
  pending.delete(c.id);
  conflict.value = null;
  if (keepMine && doc) {
    activeId.value = c.id;
    nextTick(() => setText(c.mine));
  }
}
async function syncBeforeSave(id) {
  for (let tries = 0; tries < 150; tries++) {
    const q = pending.get(id);
    if (!q?.sending && !q?.hasPending) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (pending.get(id)?.sending || pending.get(id)?.hasPending)
    throw new Error('Edits are still syncing. Try saving again.');
  if (conflict.value?.id === id) throw new Error('Resolve the edit conflict first.');
}
async function create(kind) {
  showCreate.value = false;
  try {
    const doc = await desktop.newDocument(kind);
    activeId.value = doc.id;
    mode.value = 'split';
    await nextTick();
    editorEl.value?.focus();
  } catch (e) {
    announce(e.message);
  }
}
async function openDocuments() {
  try {
    const list = await desktop.openDocuments();
    if (list.length) {
      activeId.value = list.at(-1).id;
      announce(`Opened ${list.length} file(s)`);
    }
  } catch (e) {
    announce(e.message);
  }
}
async function save(saveAs = false) {
  if (!activeDoc.value) return;
  busy.value = true;
  try {
    await syncBeforeSave(activeId.value);
    const result = await desktop.saveDocument(activeId.value, saveAs);
    if (result) {
      Object.assign(localDoc(result.id) || {}, result);
      announce(`Saved ${result.title}`);
    }
  } catch (e) {
    announce(e.message);
  } finally {
    busy.value = false;
  }
}
async function closeTab(id) {
  try {
    await syncBeforeSave(id);
    const result = await desktop.closeDocument(id);
    if (result?.saveFirst) {
      const saved = await desktop.saveDocument(id, false);
      if (saved) await desktop.closeDocument(id);
    }
  } catch (e) {
    announce(e.message);
  }
}
async function prettifyDocument() {
  if (!activeDoc.value || isLatex.value) return;
  try {
    const content = await formatMarkdown(activeDoc.value.content);
    if (content !== activeDoc.value.content) changeEditorText(content, 'format');
    announce('Markdown formatted with Prettier');
  } catch (e) {
    announce(`Prettier failed: ${e.message}`);
  }
}
async function copySource() {
  try {
    await navigator.clipboard.writeText(activeDoc.value?.content || '');
    announce('Source copied');
  } catch {
    announce('Clipboard unavailable');
  }
}
async function exportHtml() {
  if (!activeDoc.value || isLatex.value) return;
  try {
    const result = await desktop.exportHtml(activeId.value, createHtmlExport(activeDoc.value));
    if (result) announce(`Exported ${result}`);
  } catch (e) {
    announce(e.message);
  }
}
async function exportPdf() {
  if (!activeDoc.value) return;
  busy.value = true;
  try {
    await syncBeforeSave(activeId.value);
    const html = isLatex.value ? '' : createHtmlExport(activeDoc.value);
    const result = await desktop.exportPdf(activeId.value, html, engine.value);
    if (result?.error) {
      pdfError.value = result.error;
      compileLog.value = result.log || '';
      showLog.value = true;
      announce(result.error);
    } else if (result?.name) {
      announce(`Exported ${result.name}`);
      if (isLatex.value) await loadPdf();
    }
  } catch (e) {
    announce(e.message);
  } finally {
    busy.value = false;
  }
}
async function compile() {
  if (!activeDoc.value || !isLatex.value || compiling.value) return;
  compiling.value = true;
  pdfError.value = '';
  const id = activeId.value;
  try {
    await syncBeforeSave(id);
    const result = await desktop.compile(id, engine.value);
    compileLog.value = result.log || '';
    if (result.ok) {
      if (activeId.value === id) {
        pdfBytes.value = result.bytes;
        pdfSourceMap.value = result.sourceMap || [];
        pdfStale.value = false;
      }
      showLog.value = false;
      announce(`PDF compiled using ${result.engine}`);
    } else {
      pdfError.value = result.error || 'Compilation failed';
      showLog.value = true;
      announce(pdfError.value);
    }
  } catch (e) {
    pdfError.value = e.message;
    showLog.value = true;
    announce(e.message);
  } finally {
    compiling.value = false;
  }
}
async function loadPdf() {
  const request = ++previewToken;
  pdfBytes.value = null;
  pdfSourceMap.value = [];
  pdfStale.value = false;
  pdfError.value = '';
  if (!isLatex.value || !activeId.value) return;
  try {
    const result = await desktop.getPdf(activeId.value);
    if (request !== previewToken) return;
    if (result) {
      pdfBytes.value = result.bytes;
      pdfSourceMap.value = result.sourceMap || [];
      pdfStale.value = result.stale;
      compileLog.value = result.log || '';
    }
  } catch {
    /* No compilation yet. */
  }
}
async function jumpToSource(location) {
  if (!Number.isSafeInteger(location?.line) || location.line < 1) return;
  let doc = null;
  try {
    if (project.value && typeof location.file === 'string') {
      const relative = normalizedPath(location.file).replace(/^\.?\//, '');
      const expected = `${normalizedPath(project.value.root).replace(/\/$/, '')}/${relative}`.toLowerCase();
      doc = docs.value.find((item) => normalizedPath(item.filePath).toLowerCase() === expected);
      if (!doc) {
        const opened = await desktop.openProjectFile(relative);
        doc = opened.document;
        if (!doc) {
          announce('That PDF location is not an editable project source file.');
          return;
        }
        if (!localDoc(doc.id)) syncDocs([...docs.value, doc]);
      }
    } else {
      doc = activeDoc.value;
    }
    if (!doc) {
      announce('Could not find the source document for this PDF location.');
      return;
    }
    activeId.value = doc.id;
    setMode(detached && mode.value === 'preview' ? 'editor' : 'split');
    await nextTick();
    const editor = editorEl.value;
    if (!editor) return;
    const lineCount = doc.content.split('\n').length;
    const targetLine = Math.min(location.line, lineCount);
    let start = 0;
    for (let current = 1; current < targetLine; current++) {
      const newline = doc.content.indexOf('\n', start);
      if (newline < 0) break;
      start = newline + 1;
    }
    let end = doc.content.indexOf('\n', start);
    if (end < 0) end = doc.content.length;
    if (doc.content[end - 1] === '\r') end--;
    editor.focus();
    editor.setSelectionRange(start, end);
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    scrollEditorToOffset(editor, start);
    announce(`Jumped to ${location.file || doc.title}:${targetLine}`);
  } catch (e) {
    announce(e.message || 'Could not open the source location.');
  }
}
async function newProject() {
  try {
    const result = await desktop.newProject();
    if (result) {
      project.value = result.project;
      activeId.value = result.document.id;
      sidebar.value = true;
      mode.value = 'split';
      announce(`Created ${result.project.name}`);
    }
  } catch (e) {
    announce(e.message);
  }
}
async function openProject() {
  try {
    const result = await desktop.openProject();
    if (result) {
      project.value = result.project;
      if (result.document) activeId.value = result.document.id;
      sidebar.value = true;
      mode.value = 'split';
      announce(`Opened ${result.project.name}`);
    }
  } catch (e) {
    announce(e.message);
  }
}
async function openProjectFile(entry) {
  if (entry.kind === 'folder') return;
  try {
    const result = await desktop.openProjectFile(entry.path);
    if (result.document) activeId.value = result.document.id;
    else if (result.external) announce('Opened with your default application');
  } catch (e) {
    announce(e.message);
  }
}
async function newProjectFile(folder = false) {
  if (!project.value) {
    announce('Open or create a LaTeX project first.');
    return;
  }
  fileDialog.value = { folder };
  newEntryName.value = folder ? 'sections' : 'chapter.tex';
  fileDialogError.value = '';
  await nextTick();
  fileDialogInput.value?.focus();
  fileDialogInput.value?.select();
}
function cancelFileDialog() {
  fileDialog.value = null;
  fileDialogError.value = '';
}
async function submitFileDialog() {
  if (!fileDialog.value) return;
  const folder = fileDialog.value.folder;
  const name = newEntryName.value.trim();
  if (!name) {
    fileDialogError.value = 'Please enter a file or folder path.';
    return;
  }
  if (!folder && !/\.(tex|bib|sty|cls|bst|txt|md|csv)$/i.test(name)) {
    fileDialogError.value = 'Choose a supported text extension, such as .tex or .bib.';
    return;
  }
  busy.value = true;
  fileDialogError.value = '';
  try {
    const result = await desktop.createProjectFile(name, folder);
    if (result?.id) activeId.value = result.id;
    cancelFileDialog();
    announce(folder ? 'Folder created' : `Created ${name}`);
  } catch (e) {
    fileDialogError.value = e.message || 'Could not create item.';
  } finally {
    busy.value = false;
  }
}
async function importFiles() {
  if (!project.value) return;
  try {
    const added = await desktop.importProjectFiles();
    if (added.length) announce(`Added ${added.length} file(s) to project`);
  } catch (e) {
    announce(e.message);
  }
}
async function deleteFile(entry) {
  try {
    await desktop.deleteProjectFile(entry.path);
  } catch (e) {
    announce(e.message);
  }
}
async function setMain(entry) {
  try {
    project.value = await desktop.setMainTex(entry.path);
    announce(`${entry.name} is now the main TeX file`);
  } catch (e) {
    announce(e.message);
  }
}
async function refreshProject() {
  try {
    project.value = await desktop.refreshProject();
    announce('Project refreshed');
  } catch (e) {
    announce(e.message);
  }
}
async function detach(which) {
  if (!activeId.value) return;
  try {
    await desktop.detach(activeId.value, which);
  } catch (e) {
    announce(e.message);
  }
}
async function uninstall() {
  showSettings.value = false;
  try {
    const r = await desktop.requestUninstall();
    if (!r.ok && !r.cancelled) announce(r.reason);
  } catch (e) {
    announce(e.message);
  }
}
async function checkUpdates() {
  showSettings.value = false;
  try {
    const r = await desktop.checkUpdates();
    if (r.state === 'unconfigured') announce(r.message);
  } catch (e) {
    announce(e.message);
  }
}
async function installUpdate() {
  try {
    await desktop.installUpdate();
  } catch (e) {
    announce(e.message);
  }
  async function setLatexOfflineOnly(offlineOnly) {
    try {
      latexResources.value = await desktop.setLatexOfflineOnly(offlineOnly);
      announce(offlineOnly ? 'Offline-only compilation enabled' : 'On-demand package downloads enabled');
    } catch (e) {
      announce(e.message);
    }
  }
  async function openLatexCache() {
    try {
      await desktop.openLatexCache();
    } catch (e) {
      announce(e.message);
    }
  }
  async function clearLatexCache() {
    try {
      const result = await desktop.clearLatexCache();
      latexResources.value = result.resources;
      if (result.cleared) announce('Cached LaTeX resources cleared');
    } catch (e) {
      announce(e.message);
    }
  }
}
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem('mm:theme', theme.value);
}
function toggleSidebar() {
  sidebar.value = !sidebar.value;
  localStorage.setItem('mm:sidebar', sidebar.value ? 'on' : 'off');
}
function setMode(next) {
  mode.value = next;
  localStorage.setItem('mm:mode', next);
}
function insert(before, after = '', fallback = 'text') {
  if (!activeDoc.value) return;
  if (mode.value === 'preview') setMode('split');
  nextTick(() => {
    const el = editorEl.value;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    const selected = el.value.slice(start, end) || fallback;
    el.setRangeText(before + selected + after, start, end, 'select');
    el.focus();
    el.setSelectionRange(start + before.length, start + before.length + selected.length);
    const updated = el.value;
    const doc = activeDoc.value;
    if (doc) {
      editorHistory.record(
        doc.id,
        { content: doc.content, selectionStart: start, selectionEnd: end },
        selectionState(el, updated),
        'insertReplacementText',
      );
      setText(updated);
    }
  });
}
function previewClick(event) {
  const link = event.target.closest?.('a[href]');
  if (link) {
    event.preventDefault();
    desktop.openExternal(link.getAttribute('href')).catch(() => {});
    return;
  }
  const sourceBlock = event.target.closest?.('[data-source-line]');
  const line = Number(sourceBlock?.getAttribute('data-source-line'));
  if (Number.isSafeInteger(line) && line > 0) void jumpToSource({ line });
}
function startResize(event) {
  if (!paneEl.value) return;
  event.preventDefault();
  const move = (e) => {
    if (!paneEl.value) return;
    const rect = paneEl.value.getBoundingClientRect();
    paneWidth.value = Math.min(75, Math.max(25, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    localStorage.setItem('mm:split', paneWidth.value);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  resizeCleanup = end;
}
function keydown(e) {
  const key = e.key.toLowerCase(),
    mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey && key === 'z' && e.target === editorEl.value) {
    e.preventDefault();
    applyEditorHistory('undo');
  } else if (
    mod &&
    !e.altKey &&
    (key === 'y' || (key === 'z' && e.shiftKey)) &&
    e.target === editorEl.value
  ) {
    e.preventDefault();
    applyEditorHistory('redo');
  } else if (mod && key === 's') {
    e.preventDefault();
    void save(e.shiftKey);
  } else if (mod && key === 'o') {
    e.preventDefault();
    void openDocuments();
  } else if (mod && key === 'n') {
    e.preventDefault();
    void create('markdown');
  } else if (mod && key === 'enter' && isLatex.value) {
    e.preventDefault();
    void compile();
  } else if (mod && e.shiftKey && key === 'p') {
    e.preventDefault();
    void detach('split');
  } else if (mod && e.shiftKey && key === 'f' && !isLatex.value) {
    e.preventDefault();
    void prettifyDocument();
  } else if (mod && key === 'tab' && docs.value.length) {
    e.preventDefault();
    const i = docs.value.findIndex((d) => d.id === activeId.value);
    activeId.value = docs.value[(i + (e.shiftKey ? -1 : 1) + docs.value.length) % docs.value.length].id;
  } else if (mod && key === 'b' && !e.altKey) {
    e.preventDefault();
    insert(isLatex.value ? '\\textbf{' : '**', isLatex.value ? '}' : '**', 'bold');
  }
}
watch(activeId, () => {
  void loadPdf();
});
watch(engine, (v) => localStorage.setItem('mm:engine', v));
onMounted(async () => {
  window.addEventListener('keydown', keydown);
  unsub = [
    desktop.onWorkspace(syncDocs),
    desktop.onDocument(receiveDoc),
    desktop.onProject((p) => {
      project.value = p;
    }),
    desktop.onPdfStatus((event) => {
      const doc = activeDoc.value;
      if (!doc) return;
      const key = projectFile.value ? project.value.root : doc.id;
      if (event.key === key) {
        pdfStale.value = event.stale;
        if (event.ready) void loadPdf();
      }
    }),
    desktop.onUpdateStatus((status) => (updateStatus.value = status)),
    desktop.onLatexResources((resources) => (latexResources.value = resources)),
  ];
  try {
    const initial = await desktop.getWorkspace();
    docs.value = initial.documents;
    project.value = initial.project;
    updateStatus.value = initial.updateStatus;
    latexResources.value = initial.latexResources || latexResources.value;
    compilerMode.value = initial.compilerMode || 'development';
    if (compilerMode.value === 'bundled-tectonic') engine.value = 'auto';
    activeId.value =
      (detached && initial.documents.find((d) => d.id === params.get('docId'))
        ? params.get('docId')
        : initial.documents[0]?.id) || null;
  } catch (e) {
    announce(e.message || 'Desktop connection unavailable');
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keydown);
  unsub.forEach((fn) => fn());
  if (resizeCleanup) resizeCleanup();
  clearTimeout(noticeTimer);
});
</script>

<template>
  <div :class="theme === 'dark' ? 'dark' : ''" class="h-screen w-screen overflow-hidden">
    <div class="flex h-full flex-col bg-[#fff7fb] text-slate-800 dark:bg-[#17131d] dark:text-rose-50">
      <header
        v-if="!singlePaneWindow"
        class="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-rose-200/75 bg-white/95 px-4 dark:border-white/10 dark:bg-[#211b27]"
      >
        <div class="flex min-w-0 items-center gap-3">
          <img :src="logoUrl" class="size-9 rounded-xl" alt="MellowMark" />
          <div class="min-w-0">
            <div class="text-sm font-extrabold tracking-tight">
              Mellow<span class="text-rosebrand-500">Mark</span>
            </div>
            <div class="truncate text-[10px] text-slate-400 dark:text-rose-200/45">
              {{ detached ? 'Detached workspace' : 'Markdown & LaTeX workspace' }}
            </div>
          </div>
          <span
            v-if="project"
            class="hidden max-w-48 truncate rounded-lg border border-rose-100 px-2 py-1 text-[11px] text-rosebrand-600 dark:border-white/10 dark:text-rosebrand-300 lg:block"
            >{{ project.name }}</span
          >
        </div>
        <div class="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <button class="action-btn" title="Toggle files panel" @click="toggleSidebar">
            <PanelLeft :size="16" /><span class="hidden xl:inline">Files</span>
          </button>
          <button class="action-btn" @click="openDocuments">
            <FolderOpen :size="16" /><span class="hidden sm:inline">Open</span>
          </button>
          <button class="action-btn" :disabled="!activeDoc || busy" @click="save(false)">
            <Save :size="16" /><span class="hidden sm:inline">Save</span>
          </button>
          <label v-if="isLatex && compilerMode !== 'bundled-tectonic'" class="sr-only" for="latex-engine">
            LaTeX compiler
          </label>
          <select
            v-if="isLatex && compilerMode !== 'bundled-tectonic'"
            id="latex-engine"
            v-model="engine"
            class="max-w-40 rounded-lg border border-rose-200 bg-white px-2 py-2 text-xs text-slate-700 dark:border-white/20 dark:bg-[#211b27] dark:text-white sm:max-w-44"
            title="Choose the LaTeX compiler"
          >
            <option value="auto">Auto compiler</option>
            <option value="tectonic">Tectonic</option>
            <option value="pdflatex">pdfLaTeX</option>
            <option value="xelatex">XeLaTeX</option>
          </select>
          <span
            v-else-if="isLatex"
            class="rounded-lg border border-rose-200 px-2 py-2 text-xs text-slate-500 dark:border-white/10 dark:text-rose-100/70"
            title="This build uses the bundled Tectonic compiler"
          >
            Tectonic
          </span>
          <button
            v-if="isLatex"
            class="action-btn font-semibold text-rosebrand-500"
            :disabled="compiling || !activeDoc"
            @click="compile"
          >
            <RefreshCw v-if="compiling" class="animate-spin" :size="16" /><Play v-else :size="16" />{{
              compiling ? 'Compiling' : 'Compile PDF'
            }}
          </button>
          <button class="primary-btn" :disabled="busy || !activeDoc" @click="exportPdf">
            <Download :size="16" /><span class="hidden sm:inline">Export</span> PDF
          </button>
          <button
            class="action-btn"
            title="Open a new window with both source and preview"
            :disabled="!activeDoc"
            @click="detach('split')"
          >
            <Columns2 :size="16" /><span class="hidden 2xl:inline">Pop out split</span>
          </button>
          <button
            class="action-btn"
            :title="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
            @click="toggleTheme"
          >
            <Sun v-if="theme === 'dark'" :size="16" />
            <Moon v-else :size="16" />
            <span class="hidden lg:inline">{{ theme === 'dark' ? 'Light theme' : 'Dark theme' }}</span>
          </button>
          <button class="action-btn !px-2" title="Settings" @click="showSettings = !showSettings">
            <Settings2 :size="17" />
          </button>
        </div>
      </header>
      <div
        v-if="showSettings"
        class="absolute right-4 top-16 z-40 max-h-[85vh] w-80 overflow-auto rounded-xl border border-rose-200 bg-white p-4 text-sm shadow-2xl dark:border-white/15 dark:bg-[#302636]"
      >
        <div class="mb-3 flex items-center justify-between">
          <b>App settings</b><button @click="showSettings = false"><X :size="16" /></button>
        </div>
        <p v-if="compilerMode === 'bundled-tectonic'" class="text-xs text-emerald-500">
          Bundled Tectonic · downloads required resources on demand
        </p>
        <div
          v-if="compilerMode === 'bundled-tectonic' || engine === 'tectonic'"
          class="my-4 space-y-2 border-y border-rose-100 py-3 dark:border-white/10"
        >
          <b class="block text-xs">LaTeX resources</b>
          <p class="text-[11px] leading-4 text-slate-500 dark:text-rose-100/60">
            Tectonic downloads missing packages as needed and keeps them for future compilations.
          </p>
          <label class="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              class="mt-0.5 accent-rose-500"
              :checked="latexResources.offlineOnly"
              :disabled="compiling"
              @change="setLatexOfflineOnly($event.target.checked)"
            />
            <span>Offline-only (use cached packages)</span>
          </label>
          <p class="break-all text-[10px] leading-4 text-slate-400">{{ latexResources.cacheDir }}</p>
          <button class="settings-row" @click="openLatexCache">
            <FolderOpen :size="15" />Open cache folder
          </button>
          <button
            class="settings-row text-rose-600 dark:text-rose-300"
            :disabled="compiling"
            @click="clearLatexCache"
          >
            <Trash2 :size="15" />Clear cached resources
          </button>
        </div>
        <button class="settings-row" @click="save(true)"><Save :size="16" />Save As…</button>
        <button v-if="!isLatex" class="settings-row" @click="exportHtml">
          <Code2 :size="16" />Export HTML
        </button>
        <button class="settings-row" @click="copySource"><Copy :size="16" />Copy source</button>
        <button class="settings-row mt-2" @click="checkUpdates">
          <RefreshCw :size="16" />Check for updates
        </button>
        <p class="py-2 text-[11px] text-slate-400">
          {{ updateStatus.message || 'Automatic updates require a configured release server.' }}
        </p>
        <button class="settings-row text-rose-600 dark:text-rose-300" @click="uninstall">
          <Trash2 :size="16" />Uninstall MellowMark
        </button>
      </div>

      <div class="flex min-h-0 flex-1">
        <!-- Persistent disk-backed LaTeX project file explorer -->
        <aside
          v-if="sidebar && !singlePaneWindow"
          class="flex w-60 shrink-0 flex-col border-r border-rose-200 bg-[#fffbfd] dark:border-white/10 dark:bg-[#211a26] xl:w-64"
          aria-label="Project files"
        >
          <div
            class="flex h-12 items-center justify-between border-b border-rose-100 px-3 dark:border-white/10"
          >
            <span
              class="text-[11px] font-extrabold uppercase tracking-[.13em] text-slate-500 dark:text-rose-100/65"
              >Explorer</span
            ><button class="icon-btn" title="Close explorer" @click="toggleSidebar"><X :size="16" /></button>
          </div>
          <div class="space-y-2 border-b border-rose-100 p-3 dark:border-white/10">
            <div class="flex gap-1.5">
              <button class="side-btn flex-1" title="New LaTeX project" @click="newProject">
                <FolderPlus :size="15" />New project</button
              ><button class="side-btn flex-1" title="Open local project folder" @click="openProject">
                <FolderOpen :size="15" />Open folder
              </button>
            </div>
            <div v-if="project" class="flex items-center gap-1">
              <button class="icon-btn" title="New .tex/.bib file" @click="newProjectFile(false)">
                <FilePlus2 :size="17" /></button
              ><button class="icon-btn" title="New folder" @click="newProjectFile(true)">
                <FolderPlus :size="17" /></button
              ><button class="icon-btn" title="Import files" @click="importFiles">
                <Upload :size="17" /></button
              ><button class="icon-btn" title="Refresh files" @click="refreshProject">
                <RefreshCw :size="16" /></button
              ><span class="min-w-0 flex-1 truncate pl-1 text-[11px] text-slate-500" :title="project.root">{{
                project.name
              }}</span>
            </div>
          </div>
          <div class="editor-scroll min-h-0 flex-1 overflow-auto px-2 py-3">
            <template v-if="project">
              <div
                class="mb-2 flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-wider text-rosebrand-500"
              >
                <Folder :size="13" /> Project files
              </div>
              <div v-if="!project.files.length" class="p-3 text-xs text-slate-400">
                No files yet. Add a .tex file to get started.
              </div>
              <div
                v-for="file in project.files"
                :key="file.path"
                class="group mb-0.5 flex items-center rounded-lg hover:bg-rosebrand-50 dark:hover:bg-white/10"
                :class="
                  normalizedPath(activeDoc?.filePath) === normalizedPath(project.root) + '/' + file.path
                    ? 'bg-rosebrand-100 text-rosebrand-700 dark:bg-rosebrand-500/20 dark:text-rosebrand-200'
                    : ''
                "
                :style="{ paddingLeft: `${Math.min(file.path.split('/').length - 1, 5) * 10}px` }"
              >
                <button
                  class="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-[12px]"
                  :title="file.path"
                  @click="openProjectFile(file)"
                >
                  <Folder
                    v-if="file.kind === 'folder'"
                    class="shrink-0 text-amber-500"
                    :size="15"
                  /><FileCode2
                    v-else-if="file.name.endsWith('.tex')"
                    class="shrink-0 text-rosebrand-500"
                    :size="15"
                  /><FileText v-else class="shrink-0 text-slate-400" :size="15" /><span class="truncate">{{
                    file.name
                  }}</span
                  ><span
                    v-if="project.mainFile === file.path"
                    class="text-[9px] font-bold text-emerald-600 dark:text-emerald-300"
                    >MAIN</span
                  >
                </button>
                <div class="relative mr-1 shrink-0">
                  <button
                    class="icon-btn !p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="File options"
                    @click="file.options = !file.options"
                  >
                    <MoreHorizontal :size="15" />
                  </button>
                  <div
                    v-if="file.options"
                    class="absolute right-0 top-7 z-30 w-36 rounded-lg border border-rose-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#332839]"
                  >
                    <button
                      v-if="file.name.endsWith('.tex')"
                      class="menu-item"
                      @click="
                        setMain(file);
                        file.options = false;
                      "
                    >
                      <Check :size="13" /> Set as main</button
                    ><button
                      class="menu-item text-red-500"
                      @click="
                        deleteFile(file);
                        file.options = false;
                      "
                    >
                      <Trash2 :size="13" />Delete file
                    </button>
                  </div>
                </div>
              </div>
              <p class="mt-4 px-2 text-[10px] leading-5 text-slate-400">
                Files are saved in this folder on your computer. Import images, `.bib`, and other resources
                here.
              </p>
            </template>
            <div v-else class="px-3 py-5 text-center">
              <FolderOpen class="mx-auto mb-3 text-rosebrand-400" :size="32" />
              <h3 class="text-sm font-semibold">LaTeX projects</h3>
              <p class="mt-2 text-xs leading-5 text-slate-400">
                Open a folder or start a new project to manage TeX files, bibliography, and images.
              </p>
              <button class="primary-btn mx-auto mt-4 text-xs" @click="newProject">New project</button>
            </div>
          </div>
          <div class="border-t border-rose-100 p-3 text-[11px] text-slate-400 dark:border-white/10">
            <HardDrive :size="13" class="mr-1 inline" /> Local files · no account required
          </div>
        </aside>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col px-3 py-3 sm:px-4">
          <div v-if="!singlePaneWindow" class="flex h-10 shrink-0 items-center gap-1 overflow-x-auto">
            <button v-if="!sidebar" class="icon-btn" title="Show files" @click="toggleSidebar">
              <PanelLeft :size="17" />
            </button>
            <div
              v-for="doc in docs"
              :key="doc.id"
              class="flex max-w-56 shrink-0 items-center gap-1 rounded-t-lg border border-b-0 px-3 py-2 text-xs"
              :class="
                activeId === doc.id
                  ? 'border-rosebrand-200 bg-white font-semibold text-rosebrand-700 dark:border-white/10 dark:bg-[#2a222f] dark:text-rosebrand-300'
                  : 'border-transparent text-slate-400 hover:bg-rose-50 dark:hover:bg-white/5'
              "
            >
              <button class="flex min-w-0 items-center gap-2" @click="activeId = doc.id">
                <Sigma v-if="doc.kind === 'latex'" :size="14" /><FileText v-else :size="14" /><span
                  class="truncate"
                  >{{ doc.title }}</span
                ><span v-if="doc.dirty" class="size-1.5 shrink-0 rounded-full bg-amber-400"></span></button
              ><button
                class="ml-1 opacity-60 hover:opacity-100"
                :title="'Close ' + doc.title"
                @click="closeTab(doc.id)"
              >
                <X :size="13" />
              </button>
            </div>
            <div class="relative">
              <button class="icon-btn" title="New document" @click="showCreate = !showCreate">
                <Plus :size="17" />
              </button>
              <div
                v-if="showCreate"
                class="absolute left-0 top-9 z-30 w-44 rounded-xl border border-rose-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#302636]"
              >
                <button class="menu-item" @click="create('markdown')"><FileText :size="15" />Markdown</button
                ><button class="menu-item" @click="create('latex')"><Sigma :size="15" />LaTeX</button>
              </div>
            </div>
            <div class="flex-1"></div>
            <div
              class="flex items-center gap-1 rounded-lg border border-rose-200 bg-white p-0.5 text-[11px] dark:border-white/10 dark:bg-[#28212d]"
            >
              <button
                v-for="item in ['editor', 'split', 'preview']"
                :key="item"
                class="rounded-md px-2 py-1.5 capitalize"
                :class="
                  mode === item
                    ? 'bg-rosebrand-100 font-bold text-rosebrand-700 dark:bg-rosebrand-500/20 dark:text-rosebrand-200'
                    : 'text-slate-400'
                "
                @click="setMode(item)"
              >
                {{ item }}
              </button>
            </div>
          </div>

          <section
            class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl rounded-tr-2xl border border-rose-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#231c28]"
          >
            <div
              v-if="!singlePaneWindow"
              class="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-rose-100 px-3 dark:border-white/10"
            >
              <span
                class="mr-2 shrink-0 text-[10px] font-extrabold uppercase tracking-widest text-rosebrand-500"
                >{{ isLatex ? 'LaTeX tools' : 'Markdown tools' }}</span
              >
              <button
                v-for="item in formatItems"
                :key="item.label"
                class="min-w-8 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-500 hover:bg-rosebrand-50 hover:text-rosebrand-600 dark:text-rose-100/60 dark:hover:bg-white/10"
                :title="item.label"
                @click="insert(item.before, item.after, item.fallback)"
              >
                {{ item.icon }}
              </button>
              <button
                v-if="!isLatex"
                class="action-btn !px-2 text-[11px]"
                title="Format Markdown using Prettier (Ctrl+Shift+F)"
                @click="prettifyDocument"
              >
                <WandSparkles :size="15" /><span class="hidden xl:inline">Prettier</span>
              </button>
              <div class="flex-1"></div>
              <button
                class="action-btn !px-2 text-[11px]"
                title="Pop out editor-only window"
                @click="detach('editor')"
              >
                <Code2 :size="14" /><span class="hidden xl:inline">Editor window</span>
              </button>
              <button
                class="action-btn !px-2 text-[11px]"
                title="Pop out preview-only window"
                @click="detach('preview')"
              >
                <Eye :size="14" /><span class="hidden xl:inline">Preview window</span>
              </button>
              <button
                class="action-btn !px-2 text-[11px]"
                title="Pop out both panels"
                @click="detach('split')"
              >
                <Maximize2 :size="14" /><span class="hidden xl:inline">Split window</span>
              </button>
            </div>

            <div ref="paneEl" class="flex min-h-0 flex-1 overflow-hidden">
              <section
                v-if="mode !== 'preview'"
                class="flex min-w-0 flex-col bg-[#fffafd] dark:bg-[#211a26]"
                :style="{ width: mode === 'split' ? paneWidth + '%' : '100%' }"
              >
                <div
                  class="flex h-10 shrink-0 items-center gap-2 border-b border-rose-100 px-4 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:text-rose-200/60"
                >
                  <FileCode2 :size="15" />{{ docLanguage }} source
                  <span class="ml-auto font-normal normal-case text-slate-400">{{
                    activeDoc?.dirty ? 'Edited' : 'Saved'
                  }}</span>
                </div>
                <textarea
                  v-if="activeDoc"
                  ref="editorEl"
                  :key="activeDoc.id"
                  :value="activeDoc.content"
                  spellcheck="false"
                  autocorrect="off"
                  autocapitalize="off"
                  autocomplete="off"
                  class="editor-scroll min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-[1.85] text-[#342439] outline-none focus:outline-none dark:text-rose-50 sm:px-6"
                  :placeholder="isLatex ? '\\documentclass{article}…' : '# Start writing…'"
                  @beforeinput="captureEditorInput"
                  @input="updateEditorText"
                ></textarea>
              </section>
              <div
                v-if="mode === 'split'"
                class="drag-handle group relative w-2 shrink-0 bg-rose-100 hover:bg-rosebrand-300 dark:bg-white/10"
                role="separator"
                aria-label="Resize panes"
                @pointerdown="startResize"
              >
                <span
                  class="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rosebrand-300 dark:bg-rosebrand-500"
                ></span>
              </div>
              <section
                v-if="mode !== 'editor'"
                class="flex min-w-0 flex-col bg-white dark:bg-[#231c28]"
                :style="{ width: mode === 'split' ? 100 - paneWidth + '%' : '100%' }"
              >
                <div
                  class="flex h-10 shrink-0 items-center gap-2 border-b border-rose-100 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:text-rose-200/60"
                >
                  <Eye :size="15" />{{ isLatex ? 'Compiled PDF' : 'Live Markdown preview' }}
                  <span v-if="!isLatex" class="ml-auto flex items-center gap-2 text-emerald-500"
                    ><span class="size-1.5 rounded-full bg-emerald-400"></span> Live
                    <span class="hidden text-[10px] text-slate-400 sm:inline"
                      >Click text to jump to source</span
                    ></span
                  ><button
                    v-if="isLatex"
                    class="ml-auto inline-flex items-center gap-2 rounded-lg bg-rosebrand-500 px-4 py-2 text-xs font-bold normal-case text-white shadow-md ring-1 ring-rosebrand-600/30 transition hover:bg-rosebrand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rosebrand-400 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-rosebrand-400"
                    :disabled="compiling"
                    title="Compile this LaTeX document again"
                    @click="compile"
                  >
                    <RefreshCw :size="14" :class="compiling ? 'animate-spin' : ''" />
                    {{ compiling ? 'Compiling…' : 'Recompile' }}
                  </button>
                </div>
                <template v-if="isLatex">
                  <div
                    v-if="pdfError"
                    class="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-900/20 dark:text-red-200"
                  >
                    <b>Compilation error:</b> {{ pdfError }}
                    <button class="ml-2 underline" @click="showLog = true">Show log</button>
                  </div>
                  <PdfPreview
                    :bytes="pdfBytes"
                    :stale="pdfStale"
                    :source-map="pdfSourceMap"
                    @source-jump="jumpToSource"
                  />
                  <div
                    v-if="showLog"
                    class="flex max-h-[38%] min-h-32 flex-col border-t border-rose-200 bg-[#1b1721] text-rose-50"
                  >
                    <div
                      class="flex h-8 shrink-0 items-center justify-between px-3 text-[11px] font-semibold"
                    >
                      Compile log <button title="Close log" @click="showLog = false"><X :size="14" /></button>
                    </div>
                    <pre
                      class="editor-scroll overflow-auto px-4 pb-4 font-mono text-[11px] leading-5 whitespace-pre-wrap"
                      >{{ compileLog || pdfError || 'No compilation log yet.' }}</pre>
                  </div>
                  <div
                    v-else
                    class="flex h-7 shrink-0 items-center justify-end border-t border-rose-100 px-3 dark:border-white/10"
                  >
                    <button
                      class="text-[10px] text-slate-400 hover:text-rosebrand-500"
                      @click="showLog = true"
                    >
                      Show compilation log
                    </button>
                  </div>
                </template>
                <div
                  v-else
                  class="preview-scroll min-h-0 flex-1 cursor-text overflow-auto px-6 py-6 dark:bg-[#241d2a] sm:px-8"
                  @click="previewClick"
                >
                  <article
                    class="rich-preview prose prose-base prose-headings:tracking-tight prose-a:text-rosebrand-600 prose-pre:bg-ink-800 prose-pre:text-white dark:prose-invert dark:prose-a:text-rosebrand-300 max-w-none"
                    v-html="previewHtml"
                  ></article>
                </div>
              </section>
            </div>
            <div
              class="flex h-9 shrink-0 items-center justify-between border-t border-rose-100 bg-[#fffafd] px-4 text-[11px] text-slate-400 dark:border-white/10 dark:bg-[#201a25]"
            >
              <div class="flex items-center gap-2">
                <span
                  class="size-1.5 rounded-full"
                  :class="activeDoc?.dirty ? 'bg-amber-400' : 'bg-emerald-400'"
                ></span
                >{{ activeDoc?.dirty ? 'Unsaved changes' : 'Ready' }} · {{ docLanguage }}
              </div>
              <div class="flex gap-3">
                <span>{{ count.lines }} lines</span><span>{{ count.words }} words</span
                ><span class="hidden sm:inline">{{ count.chars }} chars</span>
              </div>
            </div>
          </section>
          <div
            v-if="!singlePaneWindow"
            class="mt-2 flex shrink-0 justify-between gap-4 px-2 text-[10px] text-slate-400"
          >
            <span class="flex items-center gap-1"
              ><Sparkles :size="12" class="text-rosebrand-500" /> Local-first workspace</span
            ><span class="hidden items-center gap-1 lg:flex"
              ><Keyboard :size="12" /> Ctrl+Z undo · Ctrl+Y redo · Ctrl+Enter compile</span
            >
          </div>
        </div>
      </div>
      <div
        v-if="fileDialog"
        class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5"
        @keydown.esc.stop="cancelFileDialog"
      >
        <form
          class="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl dark:border-white/15 dark:bg-[#302636]"
          @submit.prevent="submitFileDialog"
        >
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-lg font-bold">
              {{ fileDialog.folder ? 'Create project folder' : 'Create project file' }}
            </h3>
            <button type="button" class="icon-btn" aria-label="Close dialog" @click="cancelFileDialog">
              <X :size="18" />
            </button>
          </div>
          <p class="mt-2 text-xs leading-5 text-slate-500 dark:text-rose-200/70">
            {{
              fileDialog.folder
                ? 'Use a folder name such as chapters or images.'
                : 'Use a filename such as main.tex, references.bib or chapters/intro.tex.'
            }}
          </p>
          <label for="entry-name" class="mt-5 block text-xs font-semibold">{{
            fileDialog.folder ? 'Folder path' : 'Filename'
          }}</label>
          <input
            id="entry-name"
            ref="fileDialogInput"
            v-model="newEntryName"
            spellcheck="false"
            autocomplete="off"
            class="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 font-mono text-sm text-slate-800 outline-none focus:border-rosebrand-500 dark:border-white/20 dark:bg-[#211a26] dark:text-white"
            placeholder="chapter.tex"
          />
          <p v-if="fileDialogError" role="alert" class="mt-3 text-xs text-red-500">{{ fileDialogError }}</p>
          <div class="mt-6 flex justify-end gap-2">
            <button type="button" class="action-btn" @click="cancelFileDialog">Cancel</button
            ><button type="submit" class="primary-btn" :disabled="busy">
              {{ busy ? 'Creating…' : 'Create' }}
            </button>
          </div>
        </form>
      </div>
      <div
        v-if="toast"
        class="pointer-events-none fixed bottom-5 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-xl bg-[#342839] px-5 py-3 text-center text-xs text-white shadow-2xl"
      >
        {{ toast }}
      </div>
      <div v-if="conflict" class="fixed inset-0 z-50 grid place-items-center bg-black/65 p-5">
        <div
          class="w-full max-w-md rounded-2xl bg-white p-6 text-slate-800 shadow-xl dark:bg-[#332839] dark:text-white"
        >
          <h3 class="text-lg font-bold">Changes from another window</h3>
          <p class="my-4 text-sm text-slate-500 dark:text-rose-100/70">
            The document was edited elsewhere. Choose which content to keep rather than overwriting it
            automatically.
          </p>
          <div class="flex justify-end gap-2">
            <button class="action-btn" @click="resolveConflict(false)">Use other window</button
            ><button class="primary-btn" @click="resolveConflict(true)">Keep my edits</button>
          </div>
        </div>
      </div>
      <div
        v-if="updateStatus.state === 'ready'"
        class="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-xl border border-rosebrand-300 bg-white p-4 text-sm shadow-xl dark:bg-[#302636]"
      >
        <RefreshCw :size="16" />New version ready
        <button class="primary-btn" @click="installUpdate">Restart & install</button>
      </div>
    </div>
  </div>
</template>
