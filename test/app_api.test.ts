import { describe, expect, test, beforeEach } from 'vitest';
import { handleAppRequest, type AppRuntime, type RuntimeEnv } from '../src/app.js';
import { serverError } from '../src/endpoints/base.js';
import type { Device } from '../src/device/pool.js';

const BASE_ENV: RuntimeEnv = {
  AID: '1967',
  LICENSE_ID: '1611921764',
  SDK_VERSION: 'v04.04.05-ov-android',
  SDK_VERSION_INT: '134744640',
  PLATFORM: '0',
  USER_AGENT: 'com.dragon.read',
  GORGON_ALGORITHM: '8404',
  MIN_POOL_SIZE: '10',
  AUTH_PASSWORD: 'secret',
};

function makeRuntime(): AppRuntime {
  const waits: Promise<unknown>[] = [];
  return {
    waitUntil: {
      waitUntil(promise: Promise<unknown>) {
        waits.push(promise.catch(() => {}));
      },
    },
    pool: {
      async pickDevice(): Promise<Device | null> {
        return null;
      },
      async markFailed() {},
      async insert() {},
      async countReady() {
        return 0;
      },
      async cleanup() {
        return 0;
      },
      async groupStats() {
        return [];
      },
    },
    stats: {
      async record() {},
      async recordHourlyHit() {},
      async snapshot() {
        return [];
      },
      async totalCalls() {
        return 0;
      },
      async todayCalls() {
        return 0;
      },
      async cleanupHourly() {
        return 0;
      },
      async getMeta() {
        return null;
      },
      async setMeta() {},
    },
  };
}

async function readJson(response: Response): Promise<{ success: boolean; error?: string }> {
  return await response.json() as { success: boolean; error?: string };
}

describe('public API parameter limits', () => {
  beforeEach(() => {
    // These tests use POST to bypass Workers Cache API and exercise the app
    // router plus endpoint validation without requiring a Cloudflare runtime.
    delete (globalThis as { caches?: unknown }).caches;
  });

  test('content rejects too many item_ids before upstream/device access', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => String(i + 1)).join(',');
    const response = await handleAppRequest(
      new Request(`https://example.test/?api=content&item_ids=${ids}`, { method: 'POST' }),
      BASE_ENV,
      makeRuntime(),
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      success: false,
      error: 'item_ids一次最多允许20个ID',
    });
  });

  test('search rejects count over the configured limit', async () => {
    const response = await handleAppRequest(
      new Request('https://example.test/?api=search&query=abc&count=999', { method: 'POST' }),
      BASE_ENV,
      makeRuntime(),
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      success: false,
      error: 'count参数范围必须是 0-50',
    });
  });

  test('comment_list rejects count over the configured limit', async () => {
    const response = await handleAppRequest(
      new Request(
        'https://example.test/?api=comment_list&item_id=123&book_id=456&para_index=0&count=101',
        { method: 'POST' },
      ),
      BASE_ENV,
      makeRuntime(),
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      success: false,
      error: 'count参数范围必须是 1-100',
    });
  });

  test('comment_page rejects offset over the configured limit', async () => {
    const response = await handleAppRequest(
      new Request(
        'https://example.test/?api=comment_page&item_id=123&book_id=456&para_index=0&offset=1001',
        { method: 'POST' },
      ),
      BASE_ENV,
      makeRuntime(),
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      success: false,
      error: 'offset参数范围必须是 0-1000',
    });
  });
});

describe('protected and debug endpoints', () => {
  test('admin_insert_device requires POST JSON', async () => {
    const response = await handleAppRequest(
      new Request('https://example.test/?api=admin_insert_device&password=secret'),
      BASE_ENV,
      makeRuntime(),
    );

    expect(response.status).toBe(405);
    expect(await readJson(response)).toMatchObject({
      success: false,
      error: 'admin_insert_device requires POST JSON',
    });
  });

  test('admin_insert_device rejects invalid JSON body', async () => {
    const response = await handleAppRequest(
      new Request('https://example.test/?api=admin_insert_device&password=secret', {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
      BASE_ENV,
      makeRuntime(),
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      success: false,
      error: 'request body must be JSON',
    });
  });

  test('sign endpoint is disabled unless DEBUG_SIGN=1', async () => {
    const response = await handleAppRequest(
      new Request('https://example.test/?api=sign&q=aid=1967'),
      BASE_ENV,
      makeRuntime(),
    );

    expect(response.status).toBe(404);
    expect(await readJson(response)).toMatchObject({
      success: false,
      error: 'sign debug endpoint disabled',
    });
  });
});

describe('server error status classification', () => {
  test('maps upstream timeout to 504', () => {
    expect(serverError('upstream timeout after 15000ms').status).toBe(504);
  });

  test('maps empty device pool to 503', () => {
    expect(serverError('device pool is empty').status).toBe(503);
  });

  test('maps upstream HTTP errors to 502', () => {
    expect(serverError('upstream HTTP 503').status).toBe(502);
  });
});
