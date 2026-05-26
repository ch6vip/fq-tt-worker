// Shared helpers used by every endpoint.
// Mirrors final_php/BaseEndpoint.php — curlRequest, curlRequestWithDeviceRetry,
// decrypt, processContent. Each endpoint module imports what it needs.

import { signRequest, type SignatureOptions } from '../signature.js';
import type { Device } from '../device/pool.js';
import type { DevicePoolStore, StatsStore, WaitUntilContext } from '../platform.js';
import { fetchWithTimeout } from '../http.js';

const DEFAULT_USER_AGENT =
  'com.dragon.read/66732 (Linux; U; Android 10; zh_CN; Pixel 4 XL; ' +
  'Build/QD1A.190821.007;tt-ok/3.12.13.4-tiktok)';

const SIGNATURE_HEADER_KEYS = new Set([
  'x-gorgon', 'x-khronos', 'x-ss-req-ticket', 'x-ss-stub', 'x-argus', 'x-ladon',
]);

export interface EndpointContext {
  sigOpts: SignatureOptions;
  pool: DevicePoolStore;
  stats?: StatsStore;
  ctx: WaitUntilContext;
}

export interface FetchOptions {
  /** Extra request headers (lowercase keys). User-supplied signature headers are dropped. */
  headers?: Record<string, string>;
  /** POST body, raw string. */
  body?: string;
  /** Skip signing entirely. Default false. */
  noSign?: boolean;
  /** AbortSignal for timeout, etc. */
  signal?: AbortSignal;
}

export interface UpstreamResponse {
  status: number;
  text: string;
  /** Device used for this call, if applicable. */
  device?: Device;
}

/**
 * Send a signed request to an upstream URL. Does NOT consult the device pool;
 * use `fetchWithDevice` for endpoints whose URL embeds {device_id} etc.
 */
export async function signedFetch(
  url: string,
  ctx: EndpointContext,
  opts: FetchOptions = {},
): Promise<UpstreamResponse> {
  const u = new URL(url);
  const queryString = u.search.slice(1);

  const headers: Record<string, string> = {
    'user-agent': DEFAULT_USER_AGENT,
    ...stripSignatureHeaders(opts.headers ?? {}),
  };

  if (!opts.noSign) {
    const sig = await signRequest(queryString, opts.body ?? null, ctx.sigOpts);
    Object.assign(headers, sig);
  }

  const res = await fetchWithTimeout(url, {
    method: opts.body != null ? 'POST' : 'GET',
    body: opts.body,
    headers,
    signal: opts.signal,
  });
  const text = await res.text();
  return { status: res.status, text };
}

/**
 * Pick a device from the pool, substitute {device_id}/{install_id}/{secret_key}
 * in the URL, sign + fetch. On upstream errors that look like device-auth
 * failures (401/403/10001/10002), mark the device failed and retry with a new
 * one. Mirrors final_php BaseEndpoint::curlRequestWithDeviceRetry.
 */
export async function fetchWithDevice(
  urlTemplate: string,
  ctx: EndpointContext,
  opts: FetchOptions = {},
  maxRetries = 3,
): Promise<UpstreamResponse> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const device = await ctx.pool.pickDevice();
    if (!device) {
      recordDeviceFailure(ctx, 'device pool is empty');
      throw new Error('device pool is empty');
    }

    const url = urlTemplate
      .replaceAll('{device_id}', device.device_id)
      .replaceAll('{install_id}', device.install_id)
      .replaceAll('{secret_key}', device.secret_key);

    try {
      const res = await signedFetch(url, ctx, opts);
      if (looksLikeDeviceAuthFail(res.status)) {
        console.warn(`device ${device.device_id} auth failed (HTTP ${res.status}); marking failed`);
        ctx.ctx.waitUntil(ctx.pool.markFailed(device.device_id));
        recordDeviceFailure(ctx, `DEVICE_FAILED: HTTP ${res.status}`);
        lastErr = new Error(`DEVICE_FAILED: HTTP ${res.status}`);
        continue;
      }
      return { ...res, device };
    } catch (e) {
      lastErr = e as Error;
      ctx.ctx.waitUntil(ctx.pool.markFailed(device.device_id));
      recordDeviceFailure(ctx, lastErr.message);
    }
  }
  throw new Error(`fetchWithDevice failed after ${maxRetries} attempts: ${lastErr?.message ?? 'unknown'}`);
}

function looksLikeDeviceAuthFail(status: number): boolean {
  return status === 401 || status === 403 || status === 10001 || status === 10002;
}

/**
 * Pick a device, call `fn(device)`, retry with a different device on failures
 * that look device-specific. Endpoints whose URL has device params interpolated
 * via URLSearchParams should prefer this over `fetchWithDevice` (which is for
 * URL-template-with-placeholders).
 *
 * `fn` should throw `Error("DEVICE_FAILED: ...")` to signal "try a different
 * device". Anything else propagates.
 */
export async function withDeviceRetry<T>(
  ctx: EndpointContext,
  fn: (device: Device) => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Fast path: read device synchronously, schedule the touch update on waitUntil.
    const device = await ctx.pool.pickDevice(p => ctx.ctx.waitUntil(p));
    if (!device) {
      recordDeviceFailure(ctx, 'device pool is empty');
      throw new Error('device pool is empty');
    }
    try {
      return await fn(device);
    } catch (e) {
      lastErr = e as Error;
      if (!lastErr.message.startsWith('DEVICE_FAILED')) throw lastErr;
      console.warn(`device ${device.device_id} failed (attempt ${attempt + 1}): ${lastErr.message}`);
      ctx.ctx.waitUntil(ctx.pool.markFailed(device.device_id));
      recordDeviceFailure(ctx, lastErr.message);
    }
  }
  throw new Error(`withDeviceRetry exhausted after ${maxRetries}: ${lastErr?.message ?? 'unknown'}`);
}

export function isDeviceAuthFail(status: number): boolean {
  return looksLikeDeviceAuthFail(status);
}

function recordDeviceFailure(ctx: EndpointContext, reason: string): void {
  if (!ctx.stats) return;
  ctx.ctx.waitUntil(ctx.stats.recordDeviceFailure(normalizeFailureReason(reason)).catch(() => {}));
}

export function normalizeFailureReason(reason: string): string {
  const cleaned = reason
    .replace(/\bdevice[_ -]?id[=:]\s*\d+/gi, 'device_id=<redacted>')
    .replace(/\binstall[_ -]?id[=:]\s*\d+/gi, 'install_id=<redacted>')
    .replace(/\b\d{16,20}\b/g, '<id>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'unknown';
  if (/device pool is empty/i.test(cleaned)) return 'device pool is empty';
  const deviceHttp = cleaned.match(/DEVICE_FAILED:\s*HTTP\s*(\d+)/i);
  if (deviceHttp?.[1]) return `DEVICE_FAILED: HTTP ${deviceHttp[1]}`;
  if (/upstream timeout/i.test(cleaned)) return 'upstream timeout';
  const registerKeyHttp = cleaned.match(/registerkey HTTP\s*(\d+)/i);
  if (registerKeyHttp?.[1]) return `registerkey HTTP ${registerKeyHttp[1]}`;
  const deviceRegisterHttp = cleaned.match(/device_register HTTP\s*(\d+)/i);
  if (deviceRegisterHttp?.[1]) return `device_register HTTP ${deviceRegisterHttp[1]}`;
  if (/secret_key fetch failed/i.test(cleaned)) return 'secret_key fetch failed';
  return cleaned.slice(0, 180);
}

function stripSignatureHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!SIGNATURE_HEADER_KEYS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

// JSON helpers used across endpoints.

export function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  });
}

export function badRequest(error: string, hint?: string): Response {
  return new Response(JSON.stringify({ success: false, error, message: hint }, null, 2), {
    status: 400,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function serverError(error: string): Response {
  const status = classifyErrorStatus(error);
  return new Response(JSON.stringify({ success: false, error }, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function classifyErrorStatus(error: string): number {
  if (/upstream timeout|AbortError|timed out/i.test(error)) return 504;
  if (/device pool is empty/i.test(error)) return 503;
  if (/upstream HTTP|video_model HTTP|fallback_api HTTP|HTTP \d{3}|DEVICE_FAILED|withDeviceRetry exhausted|fetchWithDevice failed/i.test(error)) return 502;
  if (/JSON解析|JSON 解析|decryptResponse|decrypt failed|AES|响应中缺少|所有章节均无内容|响应无对应|为空|无法解析|未找到/i.test(error)) {
    return 502;
  }
  return 500;
}

/**
 * AES-128-CBC decrypt + optional gunzip. Mirrors BaseEndpoint::decrypt.
 *
 * Layout: base64(iv16 || ciphertext). secretKey is 32 hex chars (16 raw bytes).
 * After AES-CBC decrypt (PKCS7), if the plaintext is gzip-compressed,
 * decompress and return that; otherwise return raw plaintext.
 */
export async function decryptResponse(encryptedB64: string, secretKeyHex: string): Promise<Uint8Array> {
  const raw = base64ToBytes(encryptedB64);
  if (raw.length < 16) throw new Error('decryptResponse: payload too short');
  const iv = raw.subarray(0, 16);
  const ct = raw.subarray(16);
  const key = hexToBytes(secretKeyHex);
  if (key.length !== 16) throw new Error('decryptResponse: secret key must be 16 bytes');

  const ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, ct));

  // Detect gzip magic bytes 0x1f 0x8b and decompress.
  if (plain.length >= 2 && plain[0] === 0x1f && plain[1] === 0x8b) {
    return await gunzip(plain);
  }
  return plain;
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter();
  void w.write(data);
  void w.close();
  const r = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
