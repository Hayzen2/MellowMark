'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('installs the Map.getOrInsertComputed API used by PDF.js', async () => {
  const original = Object.getOwnPropertyDescriptor(Map.prototype, 'getOrInsertComputed');
  delete Map.prototype.getOrInsertComputed;
  try {
    await import(`../src/map-compat.js?test=${Date.now()}`);
    const map = new Map();
    let calls = 0;
    const create = (key) => {
      calls++;
      return `${key}-value`;
    };

    assert.equal(map.getOrInsertComputed('item', create), 'item-value');
    assert.equal(map.getOrInsertComputed('item', create), 'item-value');
    assert.equal(calls, 1);
  } finally {
    if (original) Object.defineProperty(Map.prototype, 'getOrInsertComputed', original);
    else delete Map.prototype.getOrInsertComputed;
  }
});
