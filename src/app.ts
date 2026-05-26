import { DEFAULT_ARGUS_CONSTANTS, type ArgusConstants } from './crypto/argus.js';
import bookSource from '../bookSource-fq-tt-worker.json';
import paragraphRule from '../paragraphRule-fq-tt-worker.json';
import { registerAndroidDevice } from './device/register.js';
import { handleBook } from './endpoints/book.js';
import { handleBookShare } from './endpoints/book_share.js';
import { handleCommentList, handleCommentPage } from './endpoints/comment_list.js';
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

const DASHBOARD_CACHE_VERSION = 'dashboard_v2_countdown';

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

function bookSourceResponse(): Response {
  return new Response(JSON.stringify(bookSource, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    },
  });
}

function paragraphRuleResponse(): Response {
  return new Response(JSON.stringify(paragraphRule, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    },
  });
}

function paragraphRuleJsResponse(): Response {
  return new Response(`${paragraphRule.jsLib}\n${paragraphRule.script}\n`, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    },
  });
}

function commentIconResponse(): Response {
  const svg =
    '<svg width="120" height="64" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M22 10h76q14 0 14 14v17q0 14-14 14H52L31 61v-6h-9Q8 55 8 41V24Q8 10 22 10z" ' +
    'fill="none" stroke="#666666" stroke-width="4"/>' +
    '<text x="60" y="41" font-family="Arial,sans-serif" font-size="26" font-weight="700" ' +
    'text-anchor="middle" fill="#666666">评</text></svg>';
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}

function commentIconPngResponse(): Response {
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAXklEQVR4nO3VwQ0AIAgDQCZl/xn44AZGKoghffRpegESxd2lM63lBBDwL0BVvSIhgJmlhgACrgHI1c+aAAHI3mdNgIDngNbv+BR1+nYXGJBRDgOyyiFAZnkIUBUCCFjJP4SR0H+XSwAAAABJRU5ErkJggg==';
  const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
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

function isProtectedEndpointAllowed(req: Request, env: RuntimeEnv): boolean {
  if (!env.ADMIN_TOKEN && !env.AUTH_PASSWORD) return true;
  return isAuthorized(req, env);
}

async function handleCachedDashboard(
  req: Request,
  env: RuntimeEnv,
  runtime: AppRuntime,
): Promise<Response> {
  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';
  if (forceRefresh && !isAuthorized(req, env)) {
    return jsonResponse({ success: false, error: 'unauthorized' }, 401);
  }

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/__dashboard_cache/${DASHBOARD_CACHE_VERSION}`, { method: 'GET' });
  if (!forceRefresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const response = await handleDashboard(runtime.stats, runtime.pool);
  const cachedResponse = new Response(response.body, response);
  cachedResponse.headers.set('cache-control', 'public, max-age=21600');
  cachedResponse.headers.set('x-dashboard-cache', forceRefresh ? 'refresh' : 'miss');
  runtime.waitUntil.waitUntil(cache.put(cacheKey, cachedResponse.clone()));
  return cachedResponse;
}

async function readDevicePayload(req: Request, url: URL): Promise<{
  device_id: string;
  install_id: string;
  secret_key: string;
}> {
  let body: Partial<{ device_id: string; install_id: string; secret_key: string }> = {};
  if (req.method !== 'GET') {
    try {
      body = await req.json() as Partial<{ device_id: string; install_id: string; secret_key: string }>;
    } catch {
      body = {};
    }
  }

  const device_id = body.device_id ?? url.searchParams.get('device_id') ?? '';
  const install_id = body.install_id ?? url.searchParams.get('install_id') ?? '';
  const secret_key = body.secret_key ?? url.searchParams.get('secret_key') ?? '';
  if (!device_id || !install_id || !/^[A-Fa-f0-9]{32}$/.test(secret_key)) {
    throw new Error('invalid device payload');
  }
  return { device_id, install_id, secret_key: secret_key.toUpperCase() };
}

export async function refillDevicePool(env: RuntimeEnv, pool: DevicePoolStore, stats: StatsStore): Promise<{
  target: number;
  readyBefore: number;
  needed: number;
  attempted: number;
  inserted: number;
  failed: number;
  errors: string[];
}>;
export async function refillDevicePool(
  env: RuntimeEnv,
  pool: DevicePoolStore,
  stats: StatsStore,
  maxAttempts: number,
): Promise<{
  target: number;
  readyBefore: number;
  needed: number;
  attempted: number;
  inserted: number;
  failed: number;
  errors: string[];
}>;
export async function refillDevicePool(
  env: RuntimeEnv,
  pool: DevicePoolStore,
  stats: StatsStore,
  maxAttempts?: number,
): Promise<{
  target: number;
  readyBefore: number;
  needed: number;
  attempted: number;
  inserted: number;
  failed: number;
  errors: string[];
}> {
  await stats.setMeta('last_cron_run', Date.now());
  await stats.setMeta('first_run', Date.now(), 'insert-if-missing');

  const removed = await pool.cleanup(7 * 24 * 60 * 60 * 1000);
  if (removed > 0) console.log(`refill: cleaned ${removed} dead/expired devices`);

  const statsRemoved = await stats.cleanupHourly();
  if (statsRemoved > 0) console.log(`refill: cleaned ${statsRemoved} old hourly stats rows`);

  const target = parseInt(env.MIN_POOL_SIZE, 10);
  const readyBefore = await pool.countReady();
  if (readyBefore >= target) {
    return { target, readyBefore, needed: 0, attempted: 0, inserted: 0, failed: 0, errors: [] };
  }

  const needed = target - readyBefore;
  const attempted = Math.max(0, Math.min(
    needed,
    Number.isFinite(maxAttempts ?? NaN) ? Math.floor(maxAttempts!) : needed,
  ));
  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];
  const sigOpts = buildSignatureOptions(env);

  for (let i = 0; i < attempted; i++) {
    try {
      const dev = await registerAndroidDevice(sigOpts, { throwOnFailure: true });
      if (!dev) {
        failed++;
        errors.push('registerAndroidDevice returned null');
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
      const message = (e as Error).message;
      errors.push(message);
      console.error('refill: registerAndroidDevice failed:', message);
    }
  }

  return { target, readyBefore, needed, attempted, inserted, failed, errors };
}

export async function handleAppRequest(req: Request, env: RuntimeEnv, runtime: AppRuntime): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/bookSource-fq-tt-worker.json' || url.searchParams.get('api') === 'book_source') {
    return bookSourceResponse();
  }
  if (url.pathname === '/paragraphRule-fq-tt-worker.json' || url.searchParams.get('api') === 'paragraph_rule') {
    return paragraphRuleResponse();
  }
  if (url.pathname === '/paragraphRule-fq-tt-worker.js' || url.searchParams.get('api') === 'paragraph_rule_js') {
    return paragraphRuleJsResponse();
  }
  if (url.pathname === '/comment-icon.svg') return commentIconResponse();
  if (url.pathname === '/comment-icon.png') return commentIconPngResponse();
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
    return handleCachedDashboard(req, env, runtime);
  }

  if (api === 'stats_detail') {
    if (!isProtectedEndpointAllowed(req, env)) return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    const ready = await runtime.pool.countReady();
    const counters = await runtime.stats.snapshot();
    return jsonResponse({ success: true, data: { ready_devices: ready, ts: Date.now(), counters } });
  }

  if (api === 'device_pool') {
    if (!isProtectedEndpointAllowed(req, env)) return jsonResponse({ success: false, error: 'unauthorized' }, 401);
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
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam == null ? 1 : Number(limitParam);
    return jsonResponse({ success: true, data: await refillDevicePool(env, runtime.pool, runtime.stats, limit) });
  }

  if (api === 'admin_insert_device') {
    if (!isAuthorized(req, env)) return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    const device = await readDevicePayload(req, url);
    await runtime.pool.insert(device);
    return jsonResponse({
      success: true,
      data: {
        device_id: device.device_id,
        install_id: device.install_id,
      },
    });
  }

  if (api === 'item_info') return handleItemInfo(req, endpointCtx);
  if (api === 'player') return handlePlayer(req);
  if (api === 'search') return handleSearch(req, endpointCtx);
  if (api === 'directory') return handleDirectory(req, endpointCtx);
  if (api === 'book_share') return handleBookShare(req, endpointCtx);
  if (api === 'comment_list') return handleCommentList(req, endpointCtx);
  if (api === 'comment_page') return handleCommentPage(req, endpointCtx);
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
      'admin_insert_device',
      'item_info', 'player', 'search', 'directory', 'book_share',
      'comment_list', 'content', 'wkcontent', 'toutiao_article', 'toutiao', 'full',
      'video (partial)', 'manga (partial)', 'book',
    ],
  }, api ? 501 : 400);
}
