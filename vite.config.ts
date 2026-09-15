import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { devApiPlugin } from './server/devApi';

export default defineConfig(({ mode }) => {
  // Server-side secrets are deliberately not VITE_-prefixed, so Vite does not
  // expose them to the browser bundle. That also means they are absent from
  // process.env during dev, where the API handlers run in this process rather
  // than as serverless functions - so load them explicitly.
  const env = loadEnv(mode, process.cwd(), '');
  const SERVER_KEYS = [
    'CONFIGCAT_API_USER',
    'CONFIGCAT_API_PASS',
    'GITHUB_TOKEN',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'AUTH_SECRET',
    'ALLOWED_EMAILS',
    'AUTH_ORIGIN',
  ];
  for (const key of SERVER_KEYS) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [react(), devApiPlugin()],
    server: { port: 5173, open: true },
  };
});
