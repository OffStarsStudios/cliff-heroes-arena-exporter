import { serveTick } from '../../server/scheduleHandler.mjs';

/**
 * Vercel serverless function backing `GET|POST /api/schedule/tick`.
 *
 * The heartbeat. Idempotent: it publishes only what should be live right now,
 * so running it twice changes nothing the second time.
 */
export default async function handler(req, res) {
  await serveTick(req, res);
}
