import { cleanupAccounts } from './server/accounts'
import { cleanupUsage } from './server/usage'
import { handleCommunity } from './server/transport'
import type { Env } from './server/platform'
export default { fetch(request: Request, env: Env) { return handleCommunity(request, env) }, scheduled(_event: unknown, env: Env, context: {waitUntil(promise: Promise<unknown>): void}) { if(env.DB)context.waitUntil(Promise.all([cleanupUsage(env.DB),cleanupAccounts(env.DB)])) } }
