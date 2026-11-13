'use strict';
const { verifyTectonic } = require('../electron/offline-tex.cjs');
try {
  const result = verifyTectonic({ packaged: false });
  console.log(`Bundled Tectonic compiler ready: ${result.exe}`);
} catch (error) {
  console.error(`Bundled Tectonic compiler missing or invalid: ${error.message}`);
  console.error('Run npm run prepare:tex:win on a connected build machine.');
  process.exitCode = 1;
}
