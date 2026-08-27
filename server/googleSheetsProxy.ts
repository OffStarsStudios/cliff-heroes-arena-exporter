import type { Plugin } from 'vite';
// @ts-expect-error - plain .mjs module shared with the production server.
import { handleGSheetRequest } from './gsheetHandler.mjs';

/**
 * Exposes `GET /api/gsheet?url=...` on the Vite dev server and preview server,
 * so Google Sheets links work with `npm run dev` out of the box.
 */
export function googleSheetsProxyPlugin(): Plugin {
  const attach = (server: { middlewares: { use: (fn: unknown) => void } }) => {
    server.middlewares.use(async (req: unknown, res: unknown, next: () => void) => {
      const handled = await handleGSheetRequest(req, res);
      if (!handled) next();
    });
  };

  return {
    name: 'cliff-heroes-google-sheets-proxy',
    configureServer: attach,
    configurePreviewServer: attach,
  } as Plugin;
}
