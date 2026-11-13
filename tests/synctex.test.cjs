'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseSyncTeX } = require('../electron/synctex.cjs');

test('maps SyncTeX page positions to source files and merges line extents', () => {
  const root = path.resolve('test-project');
  const source = [
    'SyncTeX Version:1',
    `Input:1:${path.join(root, 'main.tex')}`,
    `Input:2:${path.join(root, 'chapters', 'intro.tex')}`,
    'Content:',
    '!0',
    '{1',
    '(2,7:6000,6000:100,100,20',
    'h2,7:6000,6000:100,100,20',
    'g2,7:6000,6000',
    'g2,7:6020,6000',
    '(1,12:9000,9000:300,100,20',
    'g1,12:9000,9000',
    '(1,13:0,0:30000000,50000000,0',
    '}',
    'Postamble:',
  ].join('\n');

  assert.deepEqual(parseSyncTeX(zlib.gzipSync(source), root), [
    { page: 1, file: 'chapters/intro.tex', line: 7, x: 6000, y: 6000, width: 20, height: 0 },
    { page: 1, file: 'main.tex', line: 12, x: 9000, y: 9000, width: 0, height: 0 },
  ]);
});
