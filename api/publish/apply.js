import { serveApply } from '../../server/publishHandler.mjs';

/**
 * Vercel serverless function backing `POST /api/publish/apply`.
 *
 * The only route in this app that can change what the game serves.
 */
export default async function handler(req, res) {
  await serveApply(req, res);
}
