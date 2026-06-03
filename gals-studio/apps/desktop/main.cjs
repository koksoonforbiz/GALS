/**
 * GALS Studio desktop launcher (Electron).
 *
 * On launch it:
 *   1. ensures STUDIO_DATA_DIR exists (default ~/.gals-studio),
 *   2. runs Prisma migrations automatically (so studio.db is ready),
 *   3. starts the Fastify server in-process on a free port (it also serves the
 *      built web app), and
 *   4. opens a BrowserWindow to http://127.0.0.1:<port>.
 *
 * Signing / notarization is out of scope here; it would slot into
 * electron-builder's `mac.notarize` / `win.certificateFile` config.
 */
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const { execSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SERVER_DIR = path.join(__dirname, '..', 'studio-server');
const WEB_DIST = path.join(__dirname, '..', 'studio-web', 'dist');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(dataDir, port) {
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.STUDIO_DATABASE_URL = `file:${path.join(dataDir, 'studio.db')}`;
  process.env.STUDIO_PORT = String(port);
  process.env.STUDIO_WEB_DIST = WEB_DIST;
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });

  // Apply schema (idempotent). In a packaged build prefer `migrate deploy`.
  try {
    execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd: SERVER_DIR, env: process.env, stdio: 'ignore' });
  } catch (e) {
    console.error('migration failed', e);
  }

  // Start the server in-process (tsx loader resolves TS at runtime in dev;
  // in a packaged build this points at the compiled dist/server.js).
  const { buildServer } = await import(path.join(SERVER_DIR, 'src', 'server.js')).catch(() =>
    import(path.join(SERVER_DIR, 'dist', 'server.js')),
  );
  const server = await buildServer();
  await server.listen({ host: '127.0.0.1', port });
  return server;
}

async function main() {
  await app.whenReady();

  // First-run: let the user pick a data directory (default ~/.gals-studio).
  const defaultDir = path.join(os.homedir(), '.gals-studio');
  let dataDir = defaultDir;
  if (!fs.existsSync(defaultDir)) {
    const picked = await dialog.showOpenDialog({
      title: 'Choose a GALS Studio data folder',
      defaultPath: os.homedir(),
      properties: ['openDirectory', 'createDirectory'],
      message: 'studio.db and media/ will live here.',
    });
    if (!picked.canceled && picked.filePaths[0]) dataDir = path.join(picked.filePaths[0], 'gals-studio');
  }

  const port = await freePort();
  await startServer(dataDir, port);

  const win = new BrowserWindow({ width: 1500, height: 950, title: 'GALS Studio', webPreferences: { contextIsolation: true } });
  await win.loadURL(`http://127.0.0.1:${port}`);

  ipcMain.handle('reveal-data-dir', () => shell.openPath(dataDir));
}

app.on('window-all-closed', () => app.quit());
main().catch((err) => {
  console.error(err);
  app.quit();
});
