'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow } = require('electron');

function katexStyleWithFonts() {
  try {
    const cssPath = require.resolve('katex/dist/katex.min.css');
    const directory = path.dirname(cssPath);
    return fs.readFileSync(cssPath, 'utf8').replace(/url\(([^)]+)\)/g, (_match, raw) => {
      const rel = raw.replace(/["']/g, '').trim();
      if (!/^fonts\/[-.\w]+\.(woff2?|ttf)$/.test(rel)) return 'url()';
      const full = path.join(directory, rel);
      const type = rel.endsWith('.woff2') ? 'font/woff2' : rel.endsWith('.woff') ? 'font/woff' : 'font/ttf';
      return `url(data:${type};base64,${fs.readFileSync(full).toString('base64')})`;
    });
  } catch {
    return '';
  }
}
const printCss = `
  ${katexStyleWithFonts()}
  @page { size: A4; margin: 16mm; }
  html { background: white !important; }
  body { max-width:none !important; margin:0 !important; padding:0 !important; background: white !important; color: #262028 !important; font-family: Arial, sans-serif !important; font-size: 11pt; }
  h1,h2,h3 { color:#2c2331; line-height:1.25; break-after:avoid; }
  pre,blockquote,table { break-inside:avoid; }
  p,li { orphans:3; widows:3; }
  a { color:#a63372; }
  .katex { font-size:1em; }
  code { overflow-wrap:anywhere; }
  table { width:100%; border-collapse:collapse; }
  th,td { padding:6px; border:1px solid #dac9d1; }
`;

async function htmlToPdf(html) {
  const printWindow = new BrowserWindow({
    show: false,
    width: 1100,
    height: 850,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
    },
  });
  try {
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    const page = html
      .replace(/<link[^>]*katex[^>]*>/gi, '')
      .replace('</head>', `<style>${printCss}</style></head>`);
    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    // Script execution is disabled for print HTML; give embedded fonts a moment to load.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}
module.exports = { htmlToPdf };
