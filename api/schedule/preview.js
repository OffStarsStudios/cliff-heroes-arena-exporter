import { servePreview } from '../../server/scheduleHandler.mjs';

/** Vercel serverless function backing `GET /api/schedule/preview?id=`. */
export default async function handler(req, res) {
  await servePreview(req, res);
}
