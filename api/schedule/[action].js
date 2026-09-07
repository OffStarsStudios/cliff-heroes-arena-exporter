import { handleScheduleRequest } from '../../server/scheduleHandler.mjs';

/**
 * Every `/api/schedule/<action>` route in one serverless function: tick,
 * cancel, default and preview.
 *
 * One file rather than four because Vercel's Hobby plan allows twelve
 * functions per deployment and four near-identical two-line wrappers is a
 * wasteful way to spend a third of that budget. The shared handler in
 * `server/scheduleHandler.mjs` already dispatches on the pathname - which
 * Vercel preserves in `req.url` for a dynamic route - so this needs no routing
 * logic of its own, and the dev server keeps calling the same handler.
 */
export default async function handler(req, res) {
  const handled = await handleScheduleRequest(req, res);
  if (handled) return;

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: `No scheduling route at ${req.url}.` }));
}
