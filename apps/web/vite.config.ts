import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const apiTarget = process.env.DOCKER_ENV === '1' ? 'http://api:3000' : 'http://localhost:3000';
const minioTarget = process.env.DOCKER_ENV === '1' ? 'http://minio:9000' : 'http://localhost:9000';

export default defineConfig({
  // Plain HTTP on localhost. Browsers treat http://localhost as a secure
  // context, so WebGazer, getUserMedia, mic, and clipboard APIs all work
  // without any SSL cert setup. HTTPS is only needed when serving from a
  // non-localhost hostname (e.g. a LAN IP or a domain).
  plugins: [react()],
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
        rewrite: (path) => path.replace(/^\/s3/, ''),
      },
    },
  },
});
