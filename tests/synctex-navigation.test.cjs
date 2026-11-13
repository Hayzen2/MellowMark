'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('prefers text-sized mappings over page-sized end-document boxes', async () => {
  const { findSourceAt } = await import('../src/synctex-navigation.mjs');
  const pageBox = {
    page: 1,
    file: 'main.tex',
    line: 42,
    x: 4_600_000,
    y: 3_000_000,
    width: 30_000_000,
    height: 49_000_000,
  };
  const sentence = {
    page: 1,
    file: 'main.tex',
    line: 19,
    x: 6_000_000,
    y: 14_900_000,
    width: 12_000_000,
    height: 0,
  };

  assert.equal(findSourceAt([pageBox, sentence], 1, 10_000_000, 14_900_000), sentence);
});
