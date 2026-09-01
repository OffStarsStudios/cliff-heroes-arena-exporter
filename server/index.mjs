/**
 * Minimal production server: serves the built `dist/` folder and the
 * `/api/gsheet` proxy. Zero dependencies beyond Node itself.
 *
 *   npm run build && npm start
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleGSheetRequest } from './gsheetHandler.mjs';
import { handleConfigCatRequest } from './configcatHandler.mjs';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const port = Number(process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function readIfFile(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  if (await handleGSheetRequest(req, res)) return;
  if (await handleConfigCatRequest(req, res)) return;

  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const candidate = join(root, requested);

  // Never serve outside dist/.
  if (!candidate.startsWith(root)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  let body = requested === '' ? null : await readIfFile(candidate);
  let path = candidate;

  if (body === null) {
    path = join(root, 'index.html');
    body = await readIfFile(path);
  }

  if (body === null) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found. Run "npm run build" first.');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream');
  res.end(body);
});

server.listen(port, () => {
  console.log(`Arena Progress JSON Exporter running at http://localhost:${port}`);
});
