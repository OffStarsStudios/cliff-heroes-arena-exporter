import { serveCancel } from '../../server/scheduleHandler.mjs';

/** Vercel serverless function backing `POST /api/schedule/cancel`. */
export default async function handler(req, res) {
  await serveCancel(req, res);
}
