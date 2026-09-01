import { serveTree } from '../../server/configcatHandler.mjs';

/**
 * Vercel serverless function backing `GET /api/configcat/tree`.
 *
 * Lists products, configs, environments and settings. The ConfigCat
 * credentials are organization-wide, so this must stay server-side.
 */
export default async function handler(req, res) {
  await serveTree(req, res);
}
