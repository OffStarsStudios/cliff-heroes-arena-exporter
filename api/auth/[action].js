import { handleAuthRequest } from '../../server/authHandler.mjs';

/**
 * Every `/api/auth/<action>` route in one serverless function: login,
 * callback, logout and me. The only API function not wrapped in `withAuth`,
 * because it is how a session is made.
 */
export default async function handler(req, res) {
  const handled = await handleAuthRequest(req, res);
  if (handled) return;

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: `No sign-in route at ${req.url}.` }));
}
