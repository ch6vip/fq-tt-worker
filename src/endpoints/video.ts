// video — short-drama URL resolution.
// Two modes:
//   default: same as toutiao (reader/content/v1 + DH-decrypted text)
//   mode=urls: full PHP resolveVideoUrl path — fetch video_model, fetch
//     fallback_api, decrypt main_url / backup_url_1 via spade URL decrypt.

import { signRequest } from '../signature.js';
import { fetchWithTimeout } from '../http.js';
import {
  withDeviceRetry,
  isDeviceAuthFail,
  ok,
  badRequest,
  serverError,
  type EndpointContext,
} from './base.js';
import { handleToutiao } from './toutiao.js';
import { decryptVideoList } from '../crypto/spade.js';
import type { Device } from '../device/pool.js';

const PHOENIX_UA =
  'com.phoenix.read/71332 (Linux; U; Android 16; zh_CN; 25053RT47C; ' +
  'Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)';

function buildVideoModelURL(device: Device): string {
  return (
    `https://api5-normal-sinfonlineb.fqnovel.com/novel/player/multi_video_model/v1/` +
    `?iid=${encodeURIComponent(device.install_id)}&device_id=${encodeURIComponent(device.device_id)}` +
    `&ac=wifi&channel=update_64&aid=8662&app_name=novelread&version_code=71332` +
    `&version_name=7.1.3.32&device_platform=android&os=android&ssmix=a` +
    `&device_type=25053RT47C&device_brand=Redmi&language=zh&os_api=36&os_version=16` +
    `&manifest_version_code=71332&resolution=1280*2772&dpi=520&update_version_code=71332` +
    `&host_abi=arm64-v8a&dragon_device_type=phone&pv_player=71332&compliance_status=0` +
    `&need_personal_recommen...`
  );
}

function base64ToBytesPadded(s: string): Uint8Array {
  const trimmed = s.trim();
  const pad = trimmed.length % 4;
  const padded = pad ? trimmed + '='.repeat(4 - pad) : trimmed;
  const std = padded.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface VideoModelResponse {
  data?: Record<string, { video_model?: string | Record<string, unknown> }>;
}

interface FallbackResponse {
  video_info?: {
    data?: {
      key_seed?: string;
      video_list?: Array<Record<string, unknown>>;
    };
  };
}

export async function handleVideo(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const mode = u.searchParams.get('mode');
  if (mode !== 'urls') {
    // Default path: same as toutiao reader/content.
    return handleToutiao(req, ctx);
  }

  const videoId = u.searchParams.get('item_ids') ?? u.searchParams.get('video_id');
  if (!videoId) return badRequest('缺少 item_ids 参数');

  try {
    const result = await withDeviceRetry(ctx, async (device) => {
      // Step 1: POST multi_video_model to get the per-video fallback_api URL.
      const url = buildVideoModelURL(device);
      const body = JSON.stringify({
        biz_param: [0, 3, false, true, false, false, false, 1024],
        mixed_video_id_map: { 1004: [videoId] },
      });
      const qs = new URL(url).search.slice(1);
      const sig = await signRequest(qs, body, ctx.sigOpts);

      const res = await fetchWithTimeout(url, {
        method: 'POST',
        body,
        headers: {
          'user-agent': PHOENIX_UA,
          'content-type': 'application/json',
          accept: 'application/json; charset=utf-8,application/x-protobuf',
          'x-xs-from-web': '0',
          'sdk-version': '2',
          ...sig,
        },
      });
      if (isDeviceAuthFail(res.status)) throw new Error(`DEVICE_FAILED: HTTP ${res.status}`);
      if (!res.ok) throw new Error(`video_model HTTP ${res.status}`);

      const parsed = await res.json() as VideoModelResponse;
      const entries = parsed.data ?? {};
      const entry = entries[videoId] ?? Object.values(entries)[0];
      if (!entry) throw new Error('video_model 响应无对应 videoId');

      // video_model is either a string (JSON) or an object.
      const vmRaw = entry.video_model;
      const vm = typeof vmRaw === 'string' ? JSON.parse(vmRaw) as Record<string, unknown> : vmRaw;
      if (!vm) throw new Error('video_model 为空');

      // fallback_api can be a string, a string-encoded JSON, or an array.
      let fallbackApi: string | null = null;
      const fr = vm.fallback_api as unknown;
      if (typeof fr === 'string' && fr.length > 0 && fr[0] === '{') {
        try {
          const dec = JSON.parse(fr) as { fallback_api?: string };
          fallbackApi = dec.fallback_api ?? fr;
        } catch { fallbackApi = fr; }
      } else if (Array.isArray(fr)) {
        const arr = fr as unknown[];
        fallbackApi = (typeof arr[0] === 'string' ? arr[0] : null) as string | null;
      } else if (typeof fr === 'string' && fr.length > 10) {
        fallbackApi = fr;
      }
      if (!fallbackApi) throw new Error('fallback_api 无法解析');

      // Step 2: GET fallback_api (no signature needed — public).
      const cleanUrl = fallbackApi
        .replace(/&stream_type=encrypt/, '')
        .replace(/\?stream_type=encrypt&/, '?');

      const fbRes = await fetchWithTimeout(cleanUrl, { headers: { 'user-agent': PHOENIX_UA } });
      if (!fbRes.ok) throw new Error(`fallback_api HTTP ${fbRes.status}`);
      const fbData = await fbRes.json() as FallbackResponse;
      const videoData = fbData.video_info?.data;
      if (!videoData) throw new Error('fallback_api 响应缺 video_info.data');
      if (!videoData.key_seed) throw new Error('未找到 key_seed');

      const keySeed = base64ToBytesPadded(videoData.key_seed);

      // Step 3: decrypt every URL inline.
      if (Array.isArray(videoData.video_list)) {
        await decryptVideoList(videoData.video_list, keySeed);
      }
      return fbData;
    });
    return ok(result);
  } catch (e) {
    return serverError((e as Error).message);
  }
}
