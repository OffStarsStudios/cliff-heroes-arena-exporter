import type { Plugin } from 'vite';
// @ts-expect-error - plain .mjs modules shared with the production server.
import { handleGSheetRequest } from './gsheetHandler.mjs';
// @ts-expect-error - plain .mjs modules shared with the production server.
import { handleConfigCatRequest } from './configcatHandler.mjs';
// @ts-expect-error - plain .mjs modules shared with the production server.
import { handlePublishRequest } from './publishHandler.mjs';

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

const HANDLERS: Handler[] = [handleGSheetRequest, handleConfigCatRequest, handlePublishRequest];

/**
 * Serves the `/api/*` routes on the Vite dev and preview servers, so the app
 * behaves the same locally as it does on Vercel, where each route is its own
 * serverless function. Both call the same handlers in `server/`.
 */
export function devApiPlugin(): Plugin {
  const attach = (server: { middlewares: { use: (fn: unknown) => void } }) => {
    server.middlewares.use(async (req: unknown, res: unknown, next: () => void) => {
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
