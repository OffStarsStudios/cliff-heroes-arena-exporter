import { withAuth } from '../../server/authHandler.mjs';
import { servePlan } from '../../server/publishHandler.mjs';

/**
 * Vercel serverless function backing `POST /api/publish/plan`.
 *
 * Reports what publishing would change, and issues the baseline hash that
 * `apply` requires. Writes nothing.
 */
export default withAuth(async function handler(req, res) {
  await servePlan(req, res);
});
