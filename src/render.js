import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { annotateMarkdownSourceLines } from './markdown-source-lines.mjs';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';

for (const [name, parser] of Object.entries({
  js: javascript,
  javascript,
  ts: typescript,
  typescript,
  py: python,
  python,
  json,
  bash,
  sh: bash,
  html: xml,
  xml,
  css,
  sql,
})) {
  hljs.registerLanguage(name, parser);
}
const escape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const safe = (html) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
const math = (source, displayMode) => {
  try {
    return katex.renderToString(source.trim(), {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxExpand: 300,
    });
  } catch {
    return `<code>${escape(source)}</code>`;
  }
};

function mathExtension(md) {
  md.inline.ruler.before('escape', 'dollar_math', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
    if (state.pos && state.src[state.pos - 1] === '\\') return false;
    const start = state.pos + 1;
    if (/\s/.test(state.src[start] || '')) return false;
    let end = start;
    while ((end = state.src.indexOf('$', end)) !== -1) {
      if (state.src[end - 1] === '\\') {
        end++;
        continue;
      }
      if (/\s/.test(state.src[end - 1] || '')) {
        end++;
        continue;
      }
      break;
    }
    if (end < 0) return false;
    if (!silent) {
      const token = state.push('inline_math', 'math', 0);
      token.content = state.src.slice(start, end);
    }
    state.pos = end + 1;
    return true;
  });
  md.renderer.rules.inline_math = (tokens, idx) => math(tokens[idx].content, false);
  md.block.ruler.before('fence', 'display_math', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const end = state.eMarks[startLine];
    const row = state.src.slice(start, end).trim();
    if (!row.startsWith('$$')) return false;
    if (silent) return true;
    let next = startLine + 1;
    let buffer = row.slice(2);
    if (buffer.endsWith('$$') && buffer.length >= 2) buffer = buffer.slice(0, -2);
    else {
      let closed = false;
      while (next < endLine) {
        const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
        const endIndex = line.indexOf('$$');
        if (endIndex !== -1) {
          buffer += `\n${line.slice(0, endIndex)}`;
          closed = true;
          next++;
          break;
        }
        buffer += `\n${line}`;
        next++;
      }
      if (!closed) return false;
    }
    const token = state.push('display_math', 'math', 0);
    token.block = true;
    token.content = buffer;
    token.map = [startLine, next];
    state.line = next;
    return true;
  });
  md.renderer.rules.display_math = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const sourceLine = env?.sourceLines && token.map ? ` data-source-line="${token.map[0] + 1}"` : '';
    return `<div${sourceLine} class="my-5 overflow-x-auto">${math(token.content, true)}</div>`;
  };
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: true });
md.use(taskLists, { enabled: false });
md.use(mathExtension);
md.renderer.rules.fence = (tokens, index, _options, env) => {
  const token = tokens[index];
  const language = (token.info || '').trim().split(/\s+/)[0].toLowerCase();
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value
    : escape(token.content);
  const sourceLine = env?.sourceLines && token.map ? ` data-source-line="${token.map[0] + 1}"` : '';
  return `<pre${sourceLine} class="overflow-x-auto rounded-xl"><code class="hljs language-${escape(language)}">${highlighted}</code></pre>`;
};
const originalLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (!/^(https?:|mailto:)/i.test(href)) tokens[idx].attrSet('href', '#');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return originalLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(text) {
  return safe(md.render(text || ''));
}

export function renderMarkdownWithSource(text) {
  const env = { sourceLines: true };
  const tokens = annotateMarkdownSourceLines(md.parse(text || '', env));
  return safe(md.renderer.render(tokens, md.options, env));
}

// A deliberately scoped, offline LaTeX *preview*, not a TeX compiler. Handles common
// document structure and renders KaTeX-supported math without executing TeX commands.
function escapeAndStyle(input) {
  let value = escape(input);
  value = value.replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>');
  value = value.replace(/\\(?:emph|textit)\{([^{}]*)\}/g, '<em>$1</em>');
  value = value.replace(/\\texttt\{([^{}]*)\}/g, '<code>$1</code>');
  return value;
}
export function renderLatex(source) {
  if (!source?.trim()) return '';
  let input = source.replace(/\r\n/g, '\n');
  if (/\\begin\{document\}/.test(input))
    input = input.split(/\\begin\{document\}/)[1].split(/\\end\{document\}/)[0];
  else input = input.replace(/^\\(?:documentclass|usepackage|title|author|date)\b[^\n]*$/gm, '');
  input = input.replace(/\\maketitle\b/g, '');
  const blocks = [];
  const hold = (html) => {
    const key = `MELLOWMATHPLACEHOLDER${blocks.length}END`;
    blocks.push(html);
    return key;
  };
  input = input.replace(
    /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}/g,
    (_, env, value) => {
      const normalized = /^align|^gather|^multline/.test(env)
        ? `\\begin{aligned}${value}\\end{aligned}`
        : value;
      return `\n\n${hold(`<div class="my-6 overflow-x-auto">${math(normalized, true)}</div>`)}\n\n`;
    },
  );
  input = input.replace(
    /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g,
    (_, a, b) => `\n\n${hold(`<div class="my-6 overflow-x-auto">${math(a || b, true)}</div>`)}\n\n`,
  );
  input = input.replace(/\\\(([^]*?)\\\)|(?<!\\)\$([^$\n]+)\$/g, (_, a, b) => hold(math(a || b, false)));
  if (
    !/\n|\\(?:section|subsection|begin)/.test(input) &&
    /^\s*\\(?:frac|sqrt|sum|int|lim|left|begin|alpha|beta|gamma)/.test(input)
  ) {
    return safe(`<div class="my-6">${math(input, true)}</div>`);
  }
  const lines = input.split('\n');
  let result = '';
  let list = null;
  let paragraph = [];
  const renderText = (value) => {
    let s = escapeAndStyle(value);
    for (let i = 0; i < blocks.length; i++) s = s.replaceAll(`MELLOWMATHPLACEHOLDER${i}END`, blocks[i]);
    return s;
  };
  const flush = () => {
    if (paragraph.length) {
      result += `<p>${renderText(paragraph.join(' '))}</p>`;
      paragraph = [];
    }
  };
  const stopList = () => {
    if (list) {
      result += `</${list}>`;
      list = null;
    }
  };
  for (const original of lines) {
    const line = original.trim();
    if (!line || line === '\\par') {
      flush();
      continue;
    }
    const section = line.match(/^\\(section|subsection|subsubsection)\*?\{(.+)\}$/);
    if (section) {
      flush();
      stopList();
      const level = section[1] === 'section' ? 2 : section[1] === 'subsection' ? 3 : 4;
      result += `<h${level}>${renderText(section[2])}</h${level}>`;
      continue;
    }
    if (/^\\begin\{(itemize|enumerate)\}/.test(line)) {
      flush();
      stopList();
      list = line.includes('enumerate') ? 'ol' : 'ul';
      result += `<${list}>`;
      continue;
    }
    if (/^\\end\{(itemize|enumerate)\}/.test(line)) {
      flush();
      stopList();
      continue;
    }
    if (line.startsWith('\\item')) {
      flush();
      result += `<li>${renderText(line.replace(/^\\item\s*/, ''))}</li>`;
      continue;
    }
    if (line.startsWith('MELLOWMATHPLACEHOLDER')) {
      flush();
      result += renderText(line);
      continue;
    }
    if (/^\\(?:begin|end|usepackage|documentclass)\b/.test(line)) continue;
    paragraph.push(line.replace(/\\\\$/, ''));
  }
  flush();
  stopList();
  return safe(result);
}

export function renderDocument(doc) {
  return doc?.kind === 'latex' ? renderLatex(doc.content) : renderMarkdown(doc?.content);
}

export function createHtmlExport(doc) {
  const rendered = renderDocument(doc);
  const title = escape(doc.title);
  // KaTeX CSS is bundled inside the application, but external HTML uses this stylesheet.
  // The exported file can be viewed offline for prose; formulas require the CSS to be reachable.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css"><style>body{font:16px/1.8 system-ui,sans-serif;max-width:920px;margin:48px auto;padding:0 24px;color:#342433;background:#fff9fc}h1,h2,h3{line-height:1.3}pre{overflow:auto;background:#25202b;color:#fff;padding:18px;border-radius:10px}code{font-family:monospace}blockquote{border-left:4px solid #ee9dc5;padding-left:15px;color:#775c70}table{border-collapse:collapse;width:100%}th,td{border:1px solid #efdae4;padding:8px}a{color:#be4a84}</style></head><body><main>${rendered}</main></body></html>`;
}
