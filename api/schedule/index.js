import { serveCreate, serveList } from '../../server/scheduleHandler.mjs';

/**
 * Vercel serverless function backing `GET|POST /api/schedule`.
 *
 * GET lists every window with the defaults and the heartbeat's health.
 * POST books a window, refusing it if any guardrail fails.
 */
export default async function handler(req, res) {
  if (req.method === 'POST') await serveCreate(req, res);
  else await serveList(req, res);
}
