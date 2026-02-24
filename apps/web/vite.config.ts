import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.DOCKER_ENV === '1' ? 'http://api:3000' : 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
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
    ],
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
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
    },
  },
});
