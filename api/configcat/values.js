import { serveValues } from '../../server/configcatHandler.mjs';

/**
 * Vercel serverless function backing
 * `GET /api/configcat/values?configId=&environmentId=`.
 *
 * Returns the live value of every setting in one environment, with byte sizes
 * and, for the string settings that hold JSON, the parsed payload.
 */
export default async function handler(req, res) {
  await serveValues(req, res);
}
