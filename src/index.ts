// Worker entry. Exposes:
//   GET /sign?q=...         — debug: returns the signature headers
//   GET /api/?api=stats_detail&password=...  — pool health
//   GET /api/?api=device_pool                — raw device list
// Scheduled trigger (every 2min) cleans dead rows and warns if pool is low.
//
// Real endpoints (search/content/book/...) are NOT yet ported — they'll
// reuse signRequest() and the device pool the same way the PHP version did.

import { DevicePoolManager } from './device/pool.js';
import { registerAndroidDevice } from './device/register.js';
import { signRequest, type SignatureOptions } from './signature.js';
import { DEFAULT_ARGUS_CONSTANTS, type ArgusConstants } from './crypto/argus.js';
import { StatsManager } from './stats.js';
import { handleItemInfo } from './endpoints/item_info.js';
import { handlePlayer } from './endpoints/player.js';
import { handleSearch } from './endpoints/search.js';
import { handleDirectory } from './endpoints/directory.js';
import { handleBookShare } from './endpoints/book_share.js';
import { handleContent } from './endpoints/content.js';
import { handleWkcontent } from './endpoints/wkcontent.js';
import { handleToutiaoArticle } from './endpoints/toutiao_article.js';
import { handleToutiao } from './endpoints/toutiao.js';
import { handleFull } from './endpoints/full.js';
import { handleVideo } from './endpoints/video.js';
import { handleManga } from './endpoints/manga.js';
import { handleBook } from './endpoints/book.js';
import type { EndpointContext } from './endpoints/base.js';

export interface Env {
  DB: D1Database;
  AID: string;
  LICENSE_ID: string;
  SDK_VERSION: string;
  SDK_VERSION_INT: string;
  PLATFORM: string;
  USER_AGENT: string;
  GORGON_ALGORITHM: string;
  MIN_POOL_SIZE: string;
  AUTH_PASSWORD?: string;
  ARGUS_SIGN_KEY?: string;
  ARGUS_AES_KEY?: string;
  ARGUS_AES_IV?: string;
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function buildSignatureOptions(env: Env): SignatureOptions {
  const opts: SignatureOptions = {
    algorithm: (env.GORGON_ALGORITHM === '0404' ? '0404' : '8404'),
    aid: parseInt(env.AID, 10),
    licenseId: parseInt(env.LICENSE_ID, 10),
    sdkVersion: env.SDK_VERSION,
    sdkVersionInt: parseInt(env.SDK_VERSION_INT, 10),
    platform: parseInt(env.PLATFORM, 10),
  };
  if (env.ARGUS_SIGN_KEY && env.ARGUS_AES_KEY && env.ARGUS_AES_IV) {
    const k: ArgusConstants = {
      ...DEFAULT_ARGUS_CONSTANTS,
      signKey: hexBytes(env.ARGUS_SIGN_KEY),
      aesKey:  hexBytes(env.ARGUS_AES_KEY),
      aesIv:   hexBytes(env.ARGUS_AES_IV),
    };
    opts.argusConstants = k;
  }
  return opts;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

// --- Free plan guardrails ---
// In-memory request counter per isolate. Resets when the isolate is evicted.
// Not globally precise (multiple isolates), but prevents a single instance
// from burning through the 100K/day request quota.
let dailyCounter = 0;
let counterDay = 0; // day-of-year when counter was last reset

function checkRateLimit(): Response | null {
  const now = new Date();
  const today = now.getUTCFullYear() * 1000 + now.getUTCMonth() * 32 + now.getUTCDate();
  if (today !== counterDay) { dailyCounter = 0; counterDay = today; }
  dailyCounter++;
  if (dailyCounter > 80000) {
    return new Response(JSON.stringify({ success: false, error: 'rate limit exceeded' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '3600' },
    });
  }
  return null;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const limited = checkRateLimit();
    if (limited) return limited;

    const url = new URL(req.url);
    const api = url.searchParams.get('api') ?? '';

    const sigOpts = buildSignatureOptions(env);
    const pool = new DevicePoolManager(env.DB);
    const stats = new StatsManager(env.DB);
    const endpointCtx: EndpointContext = { sigOpts, pool, ctx };

    // Stats: 10% sampling to save D1 writes. Each write increments by 10.
    if (api && Math.random() < 0.1) {
      ctx.waitUntil(stats.recordSampled(api).catch(() => {}));
    }

    if (url.pathname === '/sign' || api === 'sign') {
      const q = url.searchParams.get('q') ?? '';
      const headers = await signRequest(q, null, sigOpts);
      return jsonResponse({ success: true, query: q, headers });
    }

    if (api === 'stats_detail') {
      if (env.AUTH_PASSWORD && url.searchParams.get('password') !== env.AUTH_PASSWORD) {
        return jsonResponse({ success: false, error: 'unauthorized' }, 401);
      }
      const ready = await pool.countReady();
      const counters = await stats.snapshot();
      return jsonResponse({ success: true, data: { ready_devices: ready, ts: Date.now(), counters } });
    }

    if (api === 'device_pool') {
      if (env.AUTH_PASSWORD && url.searchParams.get('password') !== env.AUTH_PASSWORD) {
        return jsonResponse({ success: false, error: 'unauthorized' }, 401);
      }
      const { results } = await env.DB.prepare(
        `SELECT device_id, status, last_used, use_count, created_at
         FROM devices ORDER BY created_at DESC`
      ).all();
      return jsonResponse({ success: true, data: results });
    }

    if (api === 'item_info')        return handleItemInfo(req, endpointCtx);
    if (api === 'player')           return handlePlayer(req);
    if (api === 'search')           return handleSearch(req, endpointCtx);
    if (api === 'directory')        return handleDirectory(req, endpointCtx);
    if (api === 'book_share')       return handleBookShare(req, endpointCtx);
    if (api === 'content')          return handleContent(req, endpointCtx);
    if (api === 'wkcontent')        return handleWkcontent(req, endpointCtx);
    if (api === 'toutiao_article')  return handleToutiaoArticle(req, env.AUTH_PASSWORD);
    if (api === 'toutiao')          return handleToutiao(req, endpointCtx);
    if (api === 'full')             return handleFull(req, endpointCtx);
    if (api === 'video')            return handleVideo(req, endpointCtx);
    if (api === 'manga')            return handleManga(req, endpointCtx);
    if (api === 'book')             return handleBook(req, endpointCtx);

    // Remaining endpoints still need porting — see PROGRESS.md.
    return jsonResponse({
      success: false,
      error: api ? `endpoint not yet ported: ${api}` : 'missing ?api=',
      available_now: [
        'sign (debug)', 'stats_detail', 'device_pool',
        'item_info', 'player', 'search', 'directory', 'book_share',
        'content', 'wkcontent', 'toutiao_article', 'toutiao', 'full',
        'video (partial)', 'manga (partial)', 'book',
      ],
      todo: [
        'video URL resolution (resolveVideoUrl + spade)',
        'manga image decryption (DomainImageDecryptor)',
      ],
    }, api ? 501 : 400);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const pool = new DevicePoolManager(env.DB);

    const removed = await pool.cleanup(7 * 24 * 60 * 60 * 1000);
    if (removed > 0) console.log(`cron: cleaned ${removed} dead/expired devices`);

    const target = parseInt(env.MIN_POOL_SIZE, 10);
    const ready = await pool.countReady();
    if (ready >= target) return;

    const needed = target - ready;
    console.log(`cron: pool low (${ready}/${target}), registering ${needed} device(s)`);
    const sigOpts = buildSignatureOptions(env);

    // Fire registrations in parallel via waitUntil so the scheduled handler
    // doesn't block on slow upstream calls. Each registration is best-effort;
    // failures will retry next tick.
    for (let i = 0; i < needed; i++) {
      ctx.waitUntil((async () => {
        try {
          const dev = await registerAndroidDevice(sigOpts);
          if (dev) {
            await pool.insert({
              device_id: dev.device_id,
              install_id: dev.install_id,
              secret_key: dev.secret_key,
            });
            console.log(`cron: inserted device ${dev.device_id}`);
          }
        } catch (e) {
          console.error('cron: registerAndroidDevice failed:', (e as Error).message);
        }
      })());
    }
  },
};
