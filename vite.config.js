import { resolve } from 'node:path';

const apiPort = Number(process.env.API_PORT || 3000);
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default {
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        // Keep the browser-facing Host so the API can enforce same-origin
        // requests on localhost, LAN IPs and custom development ports.
        changeOrigin: false,
      },
      '/socket.io': {
        target: apiTarget,
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
};
