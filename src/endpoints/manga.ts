// manga — fetches /reader/full/v/ + AES-decrypts (same as content endpoint).
// When the decrypted body contains `picInfos`, parses it and either returns
// the URL list + encrypt_key for client-side decryption (default), or fetches
// + decrypts every image server-side (?decode=1, watch subrequest limits).
//
// Mirrors final_php/MangaEndpoint.php + DomainImageDecryptor.php (decrypt step
// only; the PHP version's disk caching/hosting is dropped — not Worker-friendly).

import { signRequest } from '../signature.js';
import {
  withDeviceRetry,
  isDeviceAuthFail,
  decryptResponse,
  ok,
  badRequest,
  serverError,
  type EndpointContext,
} from './base.js';
import type { Device } from '../device/pool.js';
import { parsePicInfos, downloadAndDecryptImages } from '../crypto/image_decrypt.js';

function buildUrl(itemId: string, device: Device, apiType: string, customUrl: string): string {
  if (customUrl) {
    return customUrl
      .replaceAll('{$zwkey2}', device.device_id)
      .replaceAll('{$item_id}', itemId);
  }
  if (apiType === 'full') {
    return (
      `https://reading.snssdk.com/reading/reader/full/v/?aid=1967&app_name=novelapp&channel=0` +
      `&device_platform=android&device_id=${device.device_id}&device_type=Honor10` +
      `&item_id=${encodeURIComponent(itemId)}&os_version=0&version_code=66.9`
    );
  }
  return (
    `https://api5-normal-sinfonlineb.fqnovel.com/reading/reader/batch_full/v?aid=1967` +
    `&app_name=novelapp&channel=0&device_platform=android&device_id=${device.device_id}` +
    `&device_type=Honor10&os_version=0&version_code=66.9&book_id=0` +
    `&item_ids=${encodeURIComponent(itemId)}&novel_text_type=1&req_type=1`
  );
}

export async function handleManga(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const itemId = u.searchParams.get('item_ids');
  if (!itemId) return badRequest('缺少item_ids参数');
  const apiType = u.searchParams.get('api_type') ?? 'full';
  const customUrl = u.searchParams.get('custom_url') ?? '';
  const serverDecode = u.searchParams.get('decode') === '1';

  try {
    const content = await withDeviceRetry(ctx, async (device) => {
      const url = buildUrl(itemId, device, apiType, customUrl);
      const qs = new URL(url).search.slice(1);
      const sig = await signRequest(qs, null, ctx.sigOpts);
      const res = await fetch(url, { headers: { 'user-agent': 'com.dragon.read', ...sig } });
      if (isDeviceAuthFail(res.status)) throw new Error(`DEVICE_FAILED: HTTP ${res.status}`);
      if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
      const body = await res.json() as { data?: { content?: string } };
      const enc = body.data?.content;
      if (!enc) throw new Error('响应中缺少data.content字段');
      const decrypted = await decryptResponse(enc, device.secret_key);
      return new TextDecoder().decode(decrypted);
    });

    if (!content.includes('picInfos')) return ok({ content });

    // Extract embedded JSON.
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end < 0) return ok({ images: [] });
    const json = content.substring(start, end + 1);
    const parsed = parsePicInfos(json);
    if (!parsed) return ok({ raw_picinfo_json: json });

    if (serverDecode) {
      // Fetch + decrypt every image. Beware Workers subrequest budget.
      const images = await downloadAndDecryptImages(parsed.picInfos, parsed.encryptKey);
      return ok({ images });
    }

    // Default: hand off encrypt_key + URLs to the client. AES-256-GCM with
    // iv=first 12 bytes, tag=last 16 bytes of each downloaded image.
    return ok({
      encrypt_key: parsed.encryptKey,
      algorithm: 'AES-256-GCM',
      iv_offset: 0,
      iv_length: 12,
      tag_offset: -16,
      tag_length: 16,
      images: parsed.picInfos.map(p => p.picUrl).filter((x): x is string => typeof x === 'string'),
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
}
