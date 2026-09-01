import { serveDrift } from '../server/configcatHandler.mjs';

/**
 * Vercel serverless function backing
 * `GET /api/drift?configId=&from=&to=`.
 *
 * Structural comparison of two environments, setting by setting.
 */
export default async function handler(req, res) {
  await serveDrift(req, res);
}
