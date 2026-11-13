'use strict';
const { execFileSync } = require('node:child_process');
try {
  execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
  console.log('Git pre-commit Prettier check enabled.');
} catch {
  console.log('No Git repository here. Run git init and npm run hooks:enable to enable checks.');
}
