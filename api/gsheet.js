import { withAuth } from '../server/authHandler.mjs';
import { serveGSheet } from '../server/gsheetHandler.mjs';

/**
 * Vercel serverless function backing `GET /api/gsheet?url=<google export url>`.
 *
 * Google's spreadsheet export endpoints send no CORS headers, so the browser
 * cannot fetch them directly. This forwards the request server-side. The shared
 * handler only ever forwards to docs.google.com, so it is not an open relay.
 */
export default withAuth(async function handler(req, res) {
  await serveGSheet(req, res);
});
