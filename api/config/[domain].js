import { withAuth } from '../../server/authHandler.mjs';
import { serveLiveConfig } from '../../server/liveHandler.mjs';

/**
 * Vercel serverless function backing `GET /api/config/<domain>?environmentId=`.
 *
 * What ConfigCat is serving for one config right now, plus the back office's
 * own last-published record and the difference between them. Read-only.
 *
 * One dynamic function for all eight configs, both because they are the same
 * request and because Vercel's Hobby plan allows twelve per deployment.
 */
export default withAuth(async function handler(req, res) {
  await serveLiveConfig(req, res);
});
