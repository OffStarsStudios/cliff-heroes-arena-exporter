import { serveProbe } from '../../server/configcatHandler.mjs';

/**
 * Vercel serverless function backing `GET /api/configcat/probe?productId=`.
 *
 * Reports what this account and plan actually allow, rather than what the
 * documentation suggests. Read-only.
 */
export default async function handler(req, res) {
  await serveProbe(req, res);
}
