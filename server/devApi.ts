import type { Plugin } from 'vite';
// @ts-expect-error - plain .mjs modules shared with the production server.
import { gateRequest, handleAuthRequest } from './authHandler.mjs';
// @ts-expect-error - plain .mjs modules shared with the production server.
import { handleGSheetRequest } from './gsheetHandler.mjs';
// @ts-expect-error - plain .mjs modules shared with the production server.
import { handleConfigCatRequest } from './configcatHandler.mjs';
// @ts-expect-error - plain .mjs modules shared with the production server.
import { handlePublishRequest } from './publishHandler.mjs';
// @ts-expect-error - plain .mjs modules shared with the production server.
import { handleScheduleRequest } from './scheduleHandler.mjs';
// @ts-expect-error - plain .mjs modules shared with the production server.
import { handleLiveConfigRequest } from './liveHandler.mjs';

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

/**
 * Sign-in works here exactly as it does on Vercel once GOOGLE_CLIENT_ID and the
 * rest are in .env.local. With none of them set it is off, so the app still
 * runs on a laptop with nothing configured - this server is only ever local.
 */
const AUTH_OPTIONS = { allowUnconfigured: true };

const HANDLERS: Handler[] = [
  handleGSheetRequest,
  handleConfigCatRequest,
  handlePublishRequest,
  handleScheduleRequest,
  handleLiveConfigRequest,
];

/**
 * Serves the `/api/*` routes on the Vite dev and preview servers, so the app
 * behaves the same locally as it does on Vercel, where each route is its own
 * serverless function. Both call the same handlers in `server/`, behind the
 * same sign-in gate.
 */
export function devApiPlugin(): Plugin {
  const attach = (server: { middlewares: { use: (fn: unknown) => void } }) => {
    server.middlewares.use(async (req: unknown, res: unknown, next: () => void) => {
      if (await handleAuthRequest(req, res, AUTH_OPTIONS)) return;
      if (!(await gateRequest(req, res, AUTH_OPTIONS))) return;
      for (const handle of HANDLERS) {
        if (await handle(req, res)) return;
      }
      next();
    });
  };

  return {
    name: 'cliff-heroes-dev-api',
    configureServer: attach,
    configurePreviewServer: attach,
  } as Plugin;
}
