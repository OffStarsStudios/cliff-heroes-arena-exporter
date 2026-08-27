import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { googleSheetsProxyPlugin } from './server/googleSheetsProxy';

export default defineConfig({
  plugins: [react(), googleSheetsProxyPlugin()],
  server: { port: 5173, open: true },
});
