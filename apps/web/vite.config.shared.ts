import { defineConfig, type Plugin, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Two-door split: one Vite config factory, three consumers.
 *
 *   vite.config.ts          admin   → dist          (plain `vite` dev + legacy `build`)
 *   vite.config.admin.ts    admin   → dist-admin    (private door image)
 *   vite.config.student.ts  student → dist-student  (public door image)
 *
 * The door is injected as the compile-time constant `__GALS_DOOR__`
 * (declared in vite-env.d.ts, read in src/door.ts). Route strings are
 * NOT switched on it — each HTML entry imports a different app module
 * (src/entry-admin.tsx vs src/entry-student.tsx), so the student bundle
 * simply never includes teacher modules. See docs/two-door/route-table.md.
 */
export type Door = 'student' | 'admin';

export interface DoorBuildOptions {
  /** Output directory, relative to apps/web. */
  outDir: string;
  /**
   * HTML entry, relative to apps/web. Defaults to index.html (admin).
   * When it isn't index.html the emitted file is renamed to index.html so
   * nginx's `try_files ... /index.html` works identically for both doors.
   */
  input?: string;
}

const apiTarget = process.env.DOCKER_ENV === '1' ? 'http://api:3000' : 'http://localhost:3000';
const minioTarget = process.env.DOCKER_ENV === '1' ? 'http://minio:9000' : 'http://localhost:9000';

/** Rename the built HTML entry (e.g. student.html) to index.html. */
function renameHtmlEntry(from: string): Plugin {
  return {
    name: 'gals:rename-html-entry',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const entry = bundle[from];
      if (!entry) {
        this.error(`Expected the build to emit ${from} but it did not.`);
      }
      entry.fileName = 'index.html';
      delete bundle[from];
      bundle['index.html'] = entry;
    },
  };
}

export function createDoorConfig(door: Door, build: DoorBuildOptions): UserConfig {
  const input = build.input ?? 'index.html';
  const plugins: Plugin[] = [react()];
  if (input !== 'index.html') plugins.push(renameHtmlEntry(input));

  return defineConfig({
    // Plain HTTP on localhost. Browsers treat http://localhost as a secure
    // context, so WebGazer, getUserMedia, mic, and clipboard APIs all work
    // without any SSL cert setup. HTTPS is only needed when serving from a
    // non-localhost hostname (e.g. a LAN IP or a domain).
    plugins,
    define: {
      __GALS_DOOR__: JSON.stringify(door),
    },
    build: {
      outDir: build.outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, input),
      },
    },
    resolve: {
      alias: {
        'react-pdf': path.resolve(__dirname, 'node_modules/react-pdf'),
        'pdfjs-dist': path.resolve(__dirname, 'node_modules/pdfjs-dist'),
      },
    },
    optimizeDeps: {
      include: [
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@tiptap/extension-underline',
        '@tiptap/extension-text-align',
        '@tiptap/extension-link',
        '@tiptap/extension-placeholder',
        '@tiptap/extension-text-style',
        '@tiptap/extension-font-size',
        'react-pdf',
        'pdfjs-dist',
      ],
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      hmr: {
        clientPort: 5173,
      },
      // Polling is required when source files live on a Windows filesystem
      // mounted into WSL2 (/mnt/d/...). Linux inotify does not receive
      // change events across the 9P filesystem boundary, so without polling
      // Vite never detects edits and keeps serving stale compiled output.
      watch: {
        usePolling: true,
        interval: 1000,
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
        // Proxy presigned S3/MinIO requests to avoid CORS issues
        '/s3': {
          target: minioTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/s3/, ''),
        },
      },
    },
  });
}
