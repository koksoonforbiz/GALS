// Copies the Pyodide runtime assets (WASM binary + stdlib zip + lock
// file) from node_modules into public/pyodide/ so they're served
// same-origin by Vite instead of depending on an external CDN at
// runtime. Re-run automatically on install (see package.json
// "postinstall") since these live in public/, not source control.
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const pyodidePkgDir = dirname(require.resolve('pyodide/package.json'));
const destDir = join(__dirname, '..', 'public', 'pyodide');

const files = ['pyodide.asm.mjs', 'pyodide.asm.wasm', 'pyodide-lock.json', 'python_stdlib.zip'];

if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

for (const file of files) {
  const src = join(pyodidePkgDir, file);
  const dest = join(destDir, file);
  if (!existsSync(src)) {
    console.warn(`[copy-pyodide-assets] missing expected file: ${src}`);
    continue;
  }
  copyFileSync(src, dest);
}

console.log(`[copy-pyodide-assets] copied ${files.length} file(s) to ${destDir}`);
