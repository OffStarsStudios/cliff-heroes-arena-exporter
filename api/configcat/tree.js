import { withAuth } from '../../server/authHandler.mjs';
import { serveTree } from '../../server/configcatHandler.mjs';

/**
 * Vercel serverless function backing `GET /api/configcat/tree`.
 *
 * Lists products, configs, environments and settings. The ConfigCat
 * credentials are organization-wide, so this must stay server-side.
 */
export default withAuth(async function handler(req, res) {
  await serveTree(req, res);
});
