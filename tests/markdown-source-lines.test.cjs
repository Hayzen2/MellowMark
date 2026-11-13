'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const MarkdownIt = require('markdown-it');

test('marks Markdown preview blocks with their one-based source lines', async () => {
  const { annotateMarkdownSourceLines } = await import('../src/markdown-source-lines.mjs');
  const md = new MarkdownIt();
  const source = ['# Summary', '', 'A paragraph.', '', '- First item', '- Second item'].join('\n');
  const tokens = annotateMarkdownSourceLines(md.parse(source, {}));
  const html = md.renderer.render(tokens, md.options, {});

  assert.match(html, /<h1 data-source-line="1">/);
  assert.match(html, /<p data-source-line="3">/);
  assert.match(html, /<li data-source-line="5">/);
  assert.match(html, /<li data-source-line="6">/);
});
