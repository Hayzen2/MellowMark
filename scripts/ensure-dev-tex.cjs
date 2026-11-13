'use strict';
// Optional developer convenience: prepare the lightweight Tectonic executable
// used by the installer. TeX packages download on demand during compilation.
const { spawnSync } = require('node:child_process');
if (process.platform === 'win32' && process.arch === 'x64') {
  const result = spawnSync(process.execPath, ['scripts/prepare-offline-tex.mjs'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.warn(
      'Could not prepare bundled LaTeX resources for development. Markdown editing remains available.',
    );
  }
}
