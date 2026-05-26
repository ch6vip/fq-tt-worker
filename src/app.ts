import { DEFAULT_ARGUS_CONSTANTS, type ArgusConstants } from './crypto/argus.js';
import bookSource from '../bookSource-fq-tt-worker.json';
import paragraphRule from '../paragraphRule-fq-tt-worker.json';
import { RUNTIME_CONFIG } from './config.js';
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
import { normalizeFailureReason, type EndpointContext } from './endpoints/base.js';
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
  DEBUG_SIGN?: string;
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

export interface RefillDevicePoolResult {
  target: number;
  readyBefore: number;
  needed: number;
  attempted: number;
  inserted: number;
  failed: number;
  errors: string[];
  errorSummary: Array<{ reason: string; count: number }>;
  skipped: boolean;
  skipReason?: 'locked' | 'cooldown';
  lockUntil: number;
  cooldownUntil: number;
  requestedMaxAttempts: number | null;
  effectiveMaxAttempts: number;
  limitCapped: boolean;
}

const REFILL_LOCK_META_KEY = 'refill_lock_until';
const REFILL_COOLDOWN_META_KEY = 'refill_failure_cooldown_until';

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

function shouldRecordStats(api: string): { record: boolean; count: number } {
  const rate = RUNTIME_CONFIG.statsSampleRates[api] ?? 1;
  if (rate >= 1) return { record: true, count: 1 };
  if (rate <= 0) return { record: false, count: 0 };
  return Math.random() < rate
    ? { record: true, count: Math.round(1 / rate) }
    : { record: false, count: 0 };
}

function isCacheableRequest(req: Request, api: string): boolean {
  if (req.method !== 'GET') return false;
  return (RUNTIME_CONFIG.apiCacheSeconds[api] ?? 0) > 0;
}

function recordApiOutcome(runtime: AppRuntime, api: string, status: number): void {
  const sampled = shouldRecordStats(api);
  if (!sampled.record) return;
  const hourly = status >= 502 && status <= 504
    ? runtime.stats.recordHourlyFail(api, sampled.count)
    : status >= 200 && status < 400
      ? runtime.stats.recordHourlyHit(api, sampled.count)
      : Promise.resolve();
  runtime.waitUntil.waitUntil(
    Promise.all([
      runtime.stats.record(api, sampled.count),
      hourly,
    ]).catch(() => {})
  );
}

async function handleCachedApi(
  req: Request,
  api: string,
  runtime: AppRuntime,
  handler: () => Promise<Response> | Response,
): Promise<Response> {
  const ttl = RUNTIME_CONFIG.apiCacheSeconds[api] ?? 0;
  if (!ttl || !isCacheableRequest(req, api)) {
    const response = await handler();
    recordApiOutcome(runtime, api, response.status);
    return response;
  }

  const url = new URL(req.url);
  const cacheKey = new Request(`${url.origin}/__api_cache/${RUNTIME_CONFIG.apiCacheVersion}/${api}${url.search}`, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set('x-api-cache', 'hit');
    recordApiOutcome(runtime, api, hit.status);
    return hit;
  }

  const response = await handler();
  recordApiOutcome(runtime, api, response.status);
  if (response.ok) {
    const cachedResponse = new Response(response.body, response);
    cachedResponse.headers.set('cache-control', `public, max-age=${ttl}`);
    cachedResponse.headers.set('x-api-cache', 'miss');
    runtime.waitUntil.waitUntil(cache.put(cacheKey, cachedResponse.clone()));
    return cachedResponse;
  }
  return response;
}

async function handleMeasuredApi(
  api: string,
  runtime: AppRuntime,
  handler: () => Promise<Response> | Response,
): Promise<Response> {
  const response = await handler();
  recordApiOutcome(runtime, api, response.status);
  return response;
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
  const cacheKey = new Request(`${url.origin}/__dashboard_cache/${RUNTIME_CONFIG.dashboardCacheVersion}`, { method: 'GET' });
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

async function readDevicePayload(req: Request): Promise<{
  device_id: string;
  install_id: string;
  secret_key: string;
}> {
  let body: Partial<{ device_id: string; install_id: string; secret_key: string }>;
  try {
    body = await req.json() as Partial<{ device_id: string; install_id: string; secret_key: string }>;
  } catch {
    throw new Error('request body must be JSON');
  }

  const device_id = body.device_id ?? '';
  const install_id = body.install_id ?? '';
  const secret_key = body.secret_key ?? '';
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
  errorSummary: Array<{ reason: string; count: number }>;
  skipped: boolean;
  skipReason?: 'locked' | 'cooldown';
  lockUntil: number;
  cooldownUntil: number;
  requestedMaxAttempts: number | null;
  effectiveMaxAttempts: number;
  limitCapped: boolean;
}>;
export async function refillDevicePool(
  env: RuntimeEnv,
  pool: DevicePoolStore,
  stats: StatsStore,
  maxAttempts: number,
): Promise<RefillDevicePoolResult>;
export async function refillDevicePool(
  env: RuntimeEnv,
  pool: DevicePoolStore,
  stats: StatsStore,
  maxAttempts?: number,
): Promise<RefillDevicePoolResult> {
  const now = Date.now();
  await stats.setMeta('last_cron_run', now);
  await stats.setMeta('first_run', now, 'insert-if-missing');

  const target = parseInt(env.MIN_POOL_SIZE, 10);
  const readyBefore = await pool.countReady();
  const requestedMaxAttempts = Number.isFinite(maxAttempts ?? NaN) ? Math.max(0, Math.floor(maxAttempts!)) : null;
  const cappedRequestedMaxAttempts = requestedMaxAttempts == null
    ? null
    : Math.min(requestedMaxAttempts, RUNTIME_CONFIG.refill.adminMaxAttempts);
  const baseResult = (overrides: Partial<RefillDevicePoolResult> = {}): RefillDevicePoolResult => ({
    target,
    readyBefore,
    needed: Math.max(0, target - readyBefore),
    attempted: 0,
    inserted: 0,
    failed: 0,
    errors: [],
    errorSummary: [],
    skipped: false,
    lockUntil: 0,
    cooldownUntil: 0,
    requestedMaxAttempts,
    effectiveMaxAttempts: cappedRequestedMaxAttempts ?? Math.max(0, target - readyBefore),
    limitCapped: requestedMaxAttempts != null && cappedRequestedMaxAttempts !== requestedMaxAttempts,
    ...overrides,
  });

  const lockUntil = await stats.getMeta(REFILL_LOCK_META_KEY);
  if (lockUntil != null && lockUntil > now) {
    return baseResult({ skipped: true, skipReason: 'locked', lockUntil });
  }

  const cooldownUntil = await stats.getMeta(REFILL_COOLDOWN_META_KEY);
  if (cooldownUntil != null && cooldownUntil > now) {
    return baseResult({ skipped: true, skipReason: 'cooldown', cooldownUntil });
  }

  const activeLockUntil = now + RUNTIME_CONFIG.refill.lockTtlMs;
  await stats.setMeta(REFILL_LOCK_META_KEY, activeLockUntil);

  let nextCooldownUntil = 0;
  try {
    const removed = await pool.cleanup(7 * 24 * 60 * 60 * 1000);
    if (removed > 0) console.log(`refill: cleaned ${removed} dead/expired devices`);

    const statsRemoved = await stats.cleanupHourly();
    if (statsRemoved > 0) console.log(`refill: cleaned ${statsRemoved} old hourly stats rows`);

    const readyAfterCleanup = await pool.countReady();
    const needed = Math.max(0, target - readyAfterCleanup);
    if (readyAfterCleanup >= target) {
      return baseResult({
        readyBefore: readyAfterCleanup,
        needed: 0,
        effectiveMaxAttempts: cappedRequestedMaxAttempts ?? 0,
      });
    }

    const effectiveMaxAttempts = cappedRequestedMaxAttempts ?? needed;
    const attempted = Math.max(0, Math.min(needed, effectiveMaxAttempts));
    let inserted = 0;
    let failed = 0;
    const errors: string[] = [];
    const sigOpts = buildSignatureOptions(env);

    for (let i = 0; i < attempted; i++) {
      try {
        const dev = await registerAndroidDevice(sigOpts, { throwOnFailure: true });
        if (!dev) {
          failed++;
          const reason = normalizeFailureReason('registerAndroidDevice returned null');
          errors.push(reason);
          await stats.recordDeviceFailure(reason);
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
        const message = normalizeFailureReason((e as Error).message);
        errors.push(message);
        await stats.recordDeviceFailure(message);
        console.error('refill: registerAndroidDevice failed:', message);
      }
    }

    if (attempted > 0 && failed >= attempted) {
      nextCooldownUntil = Date.now() + RUNTIME_CONFIG.refill.failureCooldownMs;
      await stats.setMeta(REFILL_COOLDOWN_META_KEY, nextCooldownUntil);
    }

    return baseResult({
      needed,
      readyBefore: readyAfterCleanup,
      attempted,
      inserted,
      failed,
      errors,
      errorSummary: summarizeErrors(errors),
      lockUntil: activeLockUntil,
      cooldownUntil: nextCooldownUntil,
      effectiveMaxAttempts,
    });
  } finally {
    await stats.setMeta(REFILL_LOCK_META_KEY, 0);
  }
}

function summarizeErrors(errors: string[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const error of errors) {
    counts.set(error, (counts.get(error) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
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
  const endpointCtx: EndpointContext = { sigOpts, pool: runtime.pool, stats: runtime.stats, ctx: runtime.waitUntil };

  if (url.pathname === '/sign' || api === 'sign') {
    if (env.DEBUG_SIGN !== '1') {
      return jsonResponse({ success: false, error: 'sign debug endpoint disabled' }, 404);
    }
    const q = url.searchParams.get('q') ?? '';
    const headers = await signRequest(q, null, sigOpts);
    return jsonResponse({ success: true, query: q, headers });
  }

  if (api === 'dashboard') {
    return handleCachedDashboard(req, env, runtime);
  }

  if (api === 'stats_detail') {
    if (!isProtectedEndpointAllowed(req, env)) return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    const [ready, counters, failures, apiHealth] = await Promise.all([
      runtime.pool.countReady(),
      runtime.stats.snapshot(),
      runtime.stats.deviceFailureSummary(5),
      runtime.stats.apiHealthSummary(24, 8),
    ]);
    return jsonResponse({
      success: true,
      data: { ready_devices: ready, ts: Date.now(), counters, device_failures: failures, api_health_24h: apiHealth },
    });
  }

  if (api === 'device_pool') {
    if (!isProtectedEndpointAllowed(req, env)) return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    const [groups, failures] = await Promise.all([
      runtime.pool.groupStats(),
      runtime.stats.deviceFailureSummary(5),
    ]);
    return jsonResponse({ success: true, data: { groups, failures } });
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
    const parsedLimit = limitParam == null ? 1 : Number(limitParam);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 1;
    return jsonResponse({ success: true, data: await refillDevicePool(env, runtime.pool, runtime.stats, limit) });
  }

  if (api === 'admin_insert_device') {
    if (!isAuthorized(req, env)) return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error: 'admin_insert_device requires POST JSON' }, 405);
    }
    let device: { device_id: string; install_id: string; secret_key: string };
    try {
      device = await readDevicePayload(req);
    } catch (e) {
      return jsonResponse({ success: false, error: (e as Error).message }, 400);
    }
    await runtime.pool.insert(device);
    return jsonResponse({
      success: true,
      data: {
        device_id: device.device_id,
        install_id: device.install_id,
      },
    });
  }

  if (api === 'item_info') return handleCachedApi(req, api, runtime, () => handleItemInfo(req, endpointCtx));
  if (api === 'player') return handleMeasuredApi(api, runtime, () => handlePlayer(req));
  if (api === 'search') return handleCachedApi(req, api, runtime, () => handleSearch(req, endpointCtx));
  if (api === 'directory') return handleCachedApi(req, api, runtime, () => handleDirectory(req, endpointCtx));
  if (api === 'book_share') return handleCachedApi(req, api, runtime, () => handleBookShare(req, endpointCtx));
  if (api === 'comment_list') return handleCachedApi(req, api, runtime, () => handleCommentList(req, endpointCtx));
  if (api === 'comment_page') return handleCachedApi(req, api, runtime, () => handleCommentPage(req, endpointCtx));
  if (api === 'content') return handleCachedApi(req, api, runtime, () => handleContent(req, endpointCtx));
  if (api === 'wkcontent') return handleCachedApi(req, api, runtime, () => handleWkcontent(req, endpointCtx));
  if (api === 'toutiao_article') return handleMeasuredApi(api, runtime, () => handleToutiaoArticle(req));
  if (api === 'toutiao') return handleCachedApi(req, api, runtime, () => handleToutiao(req, endpointCtx));
  if (api === 'full') return handleCachedApi(req, api, runtime, () => handleFull(req, endpointCtx));
  if (api === 'video') return handleCachedApi(req, api, runtime, () => handleVideo(req, endpointCtx));
  if (api === 'manga') return handleCachedApi(req, api, runtime, () => handleManga(req, endpointCtx));
  if (api === 'book') return handleCachedApi(req, api, runtime, () => handleBook(req, endpointCtx));

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
