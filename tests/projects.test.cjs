'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Projects = require('../electron/projects.cjs');
const Offline = require('../electron/offline-tex.cjs');

function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm31-tests-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('create LaTeX source, nested .bib file and folder, and update project listing', () =>
  withTemp((dir) => {
    const root = path.join(dir, 'project');
    fs.mkdirSync(root);
    Projects.addFile(root, 'main.tex', '\\documentclass{article}');
    Projects.addFile(root, 'refs/library.bib', '@book{sample, title={Test}}');
    Projects.addFolder(root, 'images');
    const snapshot = Projects.inspect(root);
    assert.equal(snapshot.mainFile, 'main.tex');
    assert.equal(snapshot.files.find((f) => f.path === 'refs/library.bib').kind, 'text');
    assert.ok(snapshot.files.find((f) => f.path === 'images' && f.kind === 'folder'));
    assert.equal(fs.readFileSync(path.join(root, 'refs/library.bib'), 'utf8'), '@book{sample, title={Test}}');
  }));

test('reject unsafe paths, symlinks, duplicate names and forbidden extensions', () =>
  withTemp((root) => {
    assert.throws(() => Projects.addFile(root, '../escape.tex'), /relative path/);
    assert.throws(() => Projects.addFile(root, 'payload.exe'), /file type/);
    Projects.addFile(root, 'main.tex');
    assert.throws(() => Projects.addFile(root, 'main.tex'), /already exists/);
    fs.symlinkSync(os.tmpdir(), path.join(root, 'shortcut'), 'dir');
    assert.throws(() => Projects.addFile(root, 'shortcut/new.tex'), /Symlinks/);
  }));

test('packaged Windows requires only the bundled Tectonic compiler', () =>
  withTemp((dir) => {
    const options = { packaged: true, resourcesPath: dir, platform: 'win32', arch: 'x64' };
    assert.throws(() => Projects.chooseEngine('auto', options), /missing its bundled LaTeX compiler/);
    const resource = path.join(dir, 'tex');
    fs.mkdirSync(resource);
    const exe = path.join(resource, 'tectonic.exe');
    fs.writeFileSync(exe, 'fake binary used only in a unit test');
    const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    fs.writeFileSync(path.join(resource, 'manifest.json'), JSON.stringify({ exeSha256: sha(exe) }));
    const engine = Projects.chooseEngine('pdflatex', options);
    assert.deepEqual(engine, { name: 'tectonic', exe, offlineOnly: false });
    Offline.verifyTectonic(options);
    fs.writeFileSync(exe, 'changed');
    assert.throws(() => Offline.verifyTectonic(options), /SHA256 mismatch/);
  }));
