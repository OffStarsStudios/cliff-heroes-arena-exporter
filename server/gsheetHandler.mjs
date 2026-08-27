/**
 * Server-side fetch for public Google Sheets exports.
 *
 * Google's `/export?format=xlsx` endpoint sends no CORS headers, so the browser
 * cannot call it directly. This handler proxies the request. It only ever
 * forwards to docs.google.com, so it cannot be used as an open relay.
 */

const ALLOWED_HOSTS = new Set(['docs.google.com', 'www.google.com', 'drive.google.com']);

function send(res, status, body, contentType) {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.end(body);
}

function sendError(res, status, message) {
  send(res, status, JSON.stringify({ error: message }), 'application/json; charset=utf-8');
}

/**
 * Serves one `GET /api/gsheet?url=<google export url>` request.
 *
 * Path-agnostic so it can back both the local server (via
 * `handleGSheetRequest`) and a Vercel serverless function, which routes by
 * filename rather than by inspecting the path.
 */
export async function serveGSheet(req, res) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');

  if (req.method !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    sendError(res, 405, 'This endpoint only accepts GET.');
    return true;
  }

  const target = requestUrl.searchParams.get('url');
  if (!target) {
    sendError(res, 400, 'Missing "url" query parameter.');
    return true;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    sendError(res, 400, 'The "url" query parameter is not a valid URL.');
    return true;
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    sendError(res, 400, 'Only https://docs.google.com spreadsheet exports can be proxied.');
    return true;
  }

  try {
    const upstream = await fetch(parsed.toString(), { redirect: 'follow' });
    const buffer = Buffer.from(await upstream.arrayBuffer());

    if (!upstream.ok) {
      sendError(
        res,
        upstream.status,
        `Google returned HTTP ${upstream.status} for that sheet. Make sure it is shared with "Anyone with the link".`,
      );
      return true;
    }

    // Google answers unauthorised requests with an HTML sign-in page.
    const isZip = buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (!isZip) {
      sendError(
        res,
        403,
        'Google returned a sign-in page instead of the spreadsheet. The sheet must be shared with "Anyone with the link".',
      );
      return true;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer);
  } catch (error) {
    sendError(res, 502, `Could not reach Google Sheets: ${error?.message ?? String(error)}`);
  }

  return true;
}

/**
 * Path-matching wrapper for the local http server and the Vite dev middleware.
 * Returns `true` when the request was handled.
 */
export async function handleGSheetRequest(req, res) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (requestUrl.pathname !== '/api/gsheet') return false;
  return serveGSheet(req, res);
}
