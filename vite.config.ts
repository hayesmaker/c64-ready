import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
let gitHash = '';
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
  // ignore, may not be a git repo in some CI environments
}

export default defineConfig({
  base: '/c64-ready/',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version || '0.0.0'),
    'import.meta.env.VITE_GIT_HASH': JSON.stringify(gitHash),
  },
});

