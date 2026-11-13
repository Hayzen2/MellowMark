'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('undo and redo restore text and selection for a document', async () => {
  const { createEditorHistory } = await import('../src/editor-history.mjs');
  const history = createEditorHistory();
  const before = { content: 'hello', selectionStart: 5, selectionEnd: 5 };
  const after = { content: 'hello!', selectionStart: 6, selectionEnd: 6 };

  history.record('doc-1', before, after, 'insertText', 10);
  assert.deepEqual(history.undo('doc-1', after), before);
  assert.deepEqual(history.redo('doc-1', before), after);
});

test('groups contiguous typing and clears redo after a new edit', async () => {
  const { createEditorHistory } = await import('../src/editor-history.mjs');
  const history = createEditorHistory();
  const start = { content: '', selectionStart: 0, selectionEnd: 0 };
  const first = { content: 'h', selectionStart: 1, selectionEnd: 1 };
  const second = { content: 'hi', selectionStart: 2, selectionEnd: 2 };

  history.record('doc-1', start, first, 'insertText', 10);
  history.record('doc-1', first, second, 'insertText', 20);
  assert.deepEqual(history.undo('doc-1', second), start);
  assert.deepEqual(history.redo('doc-1', start), second);
  assert.deepEqual(history.undo('doc-1', second), start);
  history.record('doc-1', start, { content: 'x', selectionStart: 1, selectionEnd: 1 }, 'insertText', 2000);
  assert.equal(history.redo('doc-1', start), null);
});

test('keeps history isolated between documents', async () => {
  const { createEditorHistory } = await import('../src/editor-history.mjs');
  const history = createEditorHistory();
  const before = { content: 'a', selectionStart: 1, selectionEnd: 1 };
  const after = { content: 'ab', selectionStart: 2, selectionEnd: 2 };

  history.record('doc-1', before, after, 'insertText');
  assert.equal(history.undo('doc-2', after), null);
});
