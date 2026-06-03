import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = process.env.STUDIO_SERVER ?? 'http://127.0.0.1:5174';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
    },
  },
});
