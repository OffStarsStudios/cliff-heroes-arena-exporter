import { serveDefault } from '../../server/scheduleHandler.mjs';

/**
 * Vercel serverless function backing `GET|POST /api/schedule/default`.
 *
 * The fallback a config returns to when nothing is scheduled.
 */
export default async function handler(req, res) {
  await serveDefault(req, res);
}
