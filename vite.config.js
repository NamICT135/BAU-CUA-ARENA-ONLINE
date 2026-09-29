const apiPort = Number(process.env.API_PORT || 3000);
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default {
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': apiTarget,
      '/socket.io': {
        target: apiTarget,
        ws: true,
      },
    },
  },
};
