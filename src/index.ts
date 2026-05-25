// Cloudflare Worker entry.

import { buildSignatureOptions, handleAppRequest, refillDevicePool, type RuntimeEnv } from './app.js';
import { DevicePoolManager } from './device/pool.js';
import { StatsManager } from './stats.js';

export interface Env extends RuntimeEnv {
  DB: D1Database;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleAppRequest(req, env, {
      pool: new DevicePoolManager(env.DB),
      stats: new StatsManager(env.DB),
      waitUntil: ctx,
    });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const pool = new DevicePoolManager(env.DB);
    const stats = new StatsManager(env.DB);
    const task = refillDevicePool(env, pool, stats);
    ctx.waitUntil(task.then(result => {
      if (result.needed > 0) {
        console.log(
          `cron: target=${result.target} ready=${result.readyBefore} ` +
          `needed=${result.needed} inserted=${result.inserted} failed=${result.failed}`,
        );
      }
    }));

    // Preserve a synchronous reference to the signature config during scheduled
    // deploy validation, where unused imports can otherwise hide config errors.
    buildSignatureOptions(env);
  },
};
