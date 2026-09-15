import { withAuth } from '../../server/authHandler.mjs';
import { serveGitStatus } from '../../server/scheduleHandler.mjs';

/**
 * Vercel serverless function backing `GET /api/git/status`.
 *
 * Whether GITHUB_TOKEN can actually read and write this repository, and the
 * specific reason when it cannot. Read-only.
 */
export default withAuth(async function handler(req, res) {
  await serveGitStatus(req, res);
});
