import { DEFAULT_ARGUS_CONSTANTS, type ArgusConstants } from './crypto/argus.js';
import { registerAndroidDevice } from './device/register.js';
import { handleBook } from './endpoints/book.js';
import { handleBookShare } from './endpoints/book_share.js';
import { handleContent } from './endpoints/content.js';
import { handleDashboard } from './endpoints/dashboard.js';
import { handleDirectory } from './endpoints/directory.js';
import { handleFull } from './endpoints/full.js';
import { handleItemInfo } from './endpoints/item_info.js';
import { handleManga } from './endpoints/manga.js';
import { handlePlayer } from './endpoints/player.js';
import { handleSearch } from './endpoints/search.js';
import { handleToutiao } from './endpoints/toutiao.js';
import { handleToutiaoArticle } from './endpoints/toutiao_article.js';
import { handleVideo } from './endpoints/video.js';
import { handleWkcontent } from './endpoints/wkcontent.js';
import type { EndpointContext } from './endpoints/base.js';
import type { DevicePoolStore, StatsStore, WaitUntilContext } from './platform.js';
import { signRequest, type SignatureOptions } from './signature.js';

export interface RuntimeEnv {
  AID: string;
  LICENSE_ID: string;
  SDK_VERSION: string;
  SDK_VERSION_INT: string;
  PLATFORM: string;
  USER_AGENT: string;
  GORGON_ALGORITHM: string;
  MIN_POOL_SIZE: string;
  AUTH_PASSWORD?: string;
  ADMIN_TOKEN?: string;
  ARGUS_SIGN_KEY?: string;
  ARGUS_AES_KEY?: string;
  ARGUS_AES_IV?: string;
}

export interface AppRuntime {
  pool: DevicePoolStore;
  stats: StatsStore;
  waitUntil: WaitUntilContext;
  probeKV?: () => Promise<unknown>;
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
}

export function buildSignatureOptions(env: RuntimeEnv): SignatureOptions {
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
      aesKey: hexBytes(env.ARGUS_AES_KEY),
      aesIv: hexBytes(env.ARGUS_AES_IV),
    };
    opts.argusConstants = k;
  }
  return opts;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

function isAuthorized(req: Request, env: RuntimeEnv): boolean {
  const expected = env.ADMIN_TOKEN || env.AUTH_PASSWORD;
  if (!expected) return false;
  const url = new URL(req.url);
  if (url.searchParams.get('password') === expected) return true;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

export async function refillDevicePool(env: RuntimeEnv, pool: DevicePoolStore, stats: StatsStore): Promise<{
  target: number;
  readyBefore: number;
  needed: number;
  inserted: number;
  failed: number;
}> {
  await stats.setMeta('last_cron_run', Date.now());
  await stats.setMeta('first_run', Date.now(), 'insert-if-missing');

  const removed = await pool.cleanup(7 * 24 * 60 * 60 * 1000);
  if (removed > 0) console.log(`refill: cleaned ${removed} dead/expired devices`);

  const statsRemoved = await stats.cleanupHourly();
  if (statsRemoved > 0) console.log(`refill: cleaned ${statsRemoved} old hourly stats rows`);

  const target = parseInt(env.MIN_POOL_SIZE, 10);
  const readyBefore = await pool.countReady();
  if (readyBefore >= target) return { target, readyBefore, needed: 0, inserted: 0, failed: 0 };

  const needed = target - readyBefore;
  let inserted = 0;
  let failed = 0;
  const sigOpts = buildSignatureOptions(env);

  for (let i = 0; i < needed; i++) {
    try {
      const dev = await registerAndroidDevice(sigOpts);
      if (!dev) {
        failed++;
        continue;
      }
      await pool.insert({
        device_id: dev.device_id,
        install_id: dev.install_id,
        secret_key: dev.secret_key,
      });
      inserted++;
    } catch (e) {
      failed++;
      console.error('refill: registerAndroidDevice failed:', (e as Error).message);
    }
  }

  return { target, readyBefore, needed, inserted, failed };
}

export async function handleAppRequest(req: Request, env: RuntimeEnv, runtime: AppRuntime): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
  const api = url.searchParams.get('api') ?? (url.pathname === '/' ? 'dashboard' : '');

  const sigOpts = buildSignatureOptions(env);
  const endpointCtx: EndpointContext = { sigOpts, pool: runtime.pool, ctx: runtime.waitUntil };

  if (api && api !== 'dashboard' && api !== 'stats_detail' && api !== 'sign' && api !== 'admin_refill') {
    runtime.waitUntil.waitUntil(
      Promise.all([runtime.stats.record(api), runtime.stats.recordHourlyHit(api)]).catch(() => {})
    );
  }

  if (url.pathname === '/sign' || api === 'sign') {
    const q = url.searchParams.get('q') ?? '';
    const headers = await signRequest(q, null, sigOpts);
    return jsonResponse({ success: true, query: q, headers });
  }

  if (api === 'dashboard') {
    return handleDashboard(runtime.stats, runtime.pool);
  }

  if (api === 'stats_detail') {
    const ready = await runtime.pool.countReady();
    const counters = await runtime.stats.snapshot();
    return jsonResponse({ success: true, data: { ready_devices: ready, ts: Date.now(), counters } });
  }

  if (api === 'device_pool') {
    return jsonResponse({ success: true, data: await runtime.pool.groupStats() });
  }

  if (api === 'kv_probe') {
    if (!isAuthorized(req, env)) return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    const probe = runtime.probeKV;
    if (!probe) return jsonResponse({ success: false, error: 'kv_probe is not available in this runtime' }, 501);
    return jsonResponse({ success: true, data: await probe() });
  }

  if (api === 'admin_refill') {
    if (!isAuthorized(req, env)) return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    return jsonResponse({ success: true, data: await refillDevicePool(env, runtime.pool, runtime.stats) });
  }

  if (api === 'item_info') return handleItemInfo(req, endpointCtx);
  if (api === 'player') return handlePlayer(req);
  if (api === 'search') return handleSearch(req, endpointCtx);
  if (api === 'directory') return handleDirectory(req, endpointCtx);
  if (api === 'book_share') return handleBookShare(req, endpointCtx);
  if (api === 'content') return handleContent(req, endpointCtx);
  if (api === 'wkcontent') return handleWkcontent(req, endpointCtx);
  if (api === 'toutiao_article') return handleToutiaoArticle(req);
  if (api === 'toutiao') return handleToutiao(req, endpointCtx);
  if (api === 'full') return handleFull(req, endpointCtx);
  if (api === 'video') return handleVideo(req, endpointCtx);
  if (api === 'manga') return handleManga(req, endpointCtx);
  if (api === 'book') return handleBook(req, endpointCtx);

  return jsonResponse({
    success: false,
    error: api ? `endpoint not yet ported: ${api}` : 'missing ?api=',
    available_now: [
      'sign (debug)', 'stats_detail', 'device_pool', 'admin_refill',
      'item_info', 'player', 'search', 'directory', 'book_share',
      'content', 'wkcontent', 'toutiao_article', 'toutiao', 'full',
      'video (partial)', 'manga (partial)', 'book',
    ],
  }, api ? 501 : 400);
}
