import { createHandler } from '../server.mjs';

export default createHandler({
  deploymentHosts: [
    'parallel-ticker.vercel.app',
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter(Boolean),
});
