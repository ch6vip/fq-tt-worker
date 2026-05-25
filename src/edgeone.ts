// EdgeOne Pages Edge Functions entry.
//
// Build output should be copied to:
//   edge-functions/index.js
//   edge-functions/[[default]].js

import { handleAppRequest, type RuntimeEnv } from './app.js';
import { EdgeOneKVDevicePool, EdgeOneKVStats, probeKV, type EdgeOneKV } from './edgeone_kv.js';

interface EdgeOneEnv extends Partial<RuntimeEnv> {
  FQTT_KV?: EdgeOneKV;
}

interface EdgeOneContext {
  request: Request;
  env?: EdgeOneEnv;
  waitUntil?: (task: Promise<unknown>) => void;
}

class EdgeOneWaitUntil {
  private tasks: Promise<unknown>[] = [];

  waitUntil(promise: Promise<unknown>): void {
    this.tasks.push(promise.catch(() => {}));
  }

  async drain(): Promise<void> {
    if (this.tasks.length === 0) return;
    await Promise.all(this.tasks);
  }
}

function getGlobalKV(): EdgeOneKV | undefined {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.FQTT_KV) return g.FQTT_KV as EdgeOneKV;

  try {
    // EdgeOne KV docs show bound namespaces as direct global identifiers
    // (`await my_kv.get(...)`). In some runtimes that identifier is not an
    // enumerable globalThis property, so probe it explicitly.
    return (0, eval)('typeof FQTT_KV !== "undefined" ? FQTT_KV : undefined') as EdgeOneKV | undefined;
  } catch {
    return undefined;
  }
}

function requiredEnv(env: EdgeOneEnv | undefined): RuntimeEnv & { FQTT_KV: EdgeOneKV } {
  const kv = env?.FQTT_KV ?? getGlobalKV();
  if (!kv) throw new Error('missing EdgeOne KV binding: FQTT_KV');

  return {
    FQTT_KV: kv,
    AID: env?.AID ?? '1967',
    LICENSE_ID: env?.LICENSE_ID ?? '1611921764',
    SDK_VERSION: env?.SDK_VERSION ?? 'v04.04.05-ov-android',
    SDK_VERSION_INT: env?.SDK_VERSION_INT ?? '134744640',
    PLATFORM: env?.PLATFORM ?? '0',
    USER_AGENT: env?.USER_AGENT ??
      'com.dragon.read/66732 (Linux; U; Android 10; zh_CN; Pixel 4 XL; Build/QD1A.190821.007;tt-ok/3.12.13.4-tiktok)',
    GORGON_ALGORITHM: env?.GORGON_ALGORITHM ?? '8404',
    MIN_POOL_SIZE: env?.MIN_POOL_SIZE ?? '10',
    AUTH_PASSWORD: env?.AUTH_PASSWORD,
    ADMIN_TOKEN: env?.ADMIN_TOKEN,
    ARGUS_SIGN_KEY: env?.ARGUS_SIGN_KEY,
    ARGUS_AES_KEY: env?.ARGUS_AES_KEY,
    ARGUS_AES_IV: env?.ARGUS_AES_IV,
  };
}

export async function onRequest(context: EdgeOneContext): Promise<Response> {
  const { request, env } = context;
  const waitUntil = new EdgeOneWaitUntil();
  const waitUntilAdapter = {
    waitUntil: (task: Promise<unknown>) => {
      if (typeof context.waitUntil === 'function') context.waitUntil(task);
      else waitUntil.waitUntil(task);
    },
  };
  try {
    const runtimeEnv = requiredEnv(env);
    const response = await handleAppRequest(request, runtimeEnv, {
      pool: new EdgeOneKVDevicePool(runtimeEnv.FQTT_KV),
      stats: new EdgeOneKVStats(runtimeEnv.FQTT_KV),
      waitUntil: waitUntilAdapter,
      probeKV: () => probeKV(runtimeEnv.FQTT_KV),
    });
    await waitUntil.drain();
    return response;
  } catch (e) {
    await waitUntil.drain();
    return new Response(JSON.stringify({
      success: false,
      error: (e as Error).message,
    }, null, 2), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}

export default onRequest;
