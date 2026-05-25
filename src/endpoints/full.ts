// full — multi-chapter content via DH-handshake POST to novelfm-hl.snssdk.com.
// Mirrors final_php/FullEndpoint.php — supports GET and POST.

import { signRequest } from '../signature.js';
import {
  withDeviceRetry,
  isDeviceAuthFail,
  ok,
  badRequest,
  serverError,
  type EndpointContext,
} from './base.js';
import { getCM, refillCMPool } from '../crypto/cm.js';
import type { Device } from '../device/pool.js';

interface FullResponse {
  data?: { item_infos?: Record<string, ChapterInfo> | ChapterInfo[] };
}

interface ChapterInfo {
  key?: string;
  content?: string;
  title?: string;
}

interface OutChapter {
  item_id?: string;
  title: string;
  content: string;
}

function buildUrl(device: Device): string {
  return (
    `https://novelfm-hl.snssdk.com/novelfm/playerapi/full/mget/v1/?aid=3040` +
    `&app_name=novelapp&channel=0&device_id=${device.device_id}` +
    `&device_platform=android&device_type=UGFFI55&iid=${device.install_id}` +
    `&os_version=0&version_code=58932&version_name=5.8.9.32`
  );
}

const FULL_STRIP_PATTERNS: RegExp[] = [
  /<p class="pictureDesc" group-id="\d+" idx="\d+">/g,
  /<\/body>|<\/html>|<\/div>/g,
  /<p class="picture" group-id="\d+">/g,
  /<div data-fanqie-type="image" source="user">/g,
  /<head>.*<\/h1>/gs,
  /<!DOCTYPE.*<html>/gs,
  /<\?xml.*\?>/gs,
  /<p idx="\d+">/g,
  /<header>|<\/header>/g,
  /<article>|<\/article>/g,
  /<footer>|<\/footer>/g,
  /<tt_keyword.*keyword_ad>/g,
  /<p>/g,
];

function processFullContent(content: string): string {
  let s = content;
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\s*p[^>]*>/gi, '\n');
  s = s.replace(/<\s*\/p\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  for (const p of FULL_STRIP_PATTERNS) { p.lastIndex = 0; s = s.replace(p, ''); }
  s = s.replace(/&amp;x/g, '&x');
  s = s.replace(/\n{2,}/g, '\n');
  return s.trim();
}

export async function handleFull(req: Request, ctx: EndpointContext): Promise<Response> {
  let bookId: string | null = null;
  let itemIds: string[] = [];

  if (req.method === 'POST') {
    let body: { book_id?: string; item_ids?: string[] };
    try {
      body = await req.json() as { book_id?: string; item_ids?: string[] };
    } catch {
      return badRequest('请求体必须是有效的JSON格式');
    }
    bookId = body.book_id ?? null;
    itemIds = Array.isArray(body.item_ids) ? body.item_ids : [];
    if (!bookId) return badRequest('缺少必要参数: book_id');
    if (itemIds.length === 0) return badRequest('缺少必要参数: item_ids (必须是数组)');
  } else if (req.method === 'GET') {
    const u = new URL(req.url);
    bookId = u.searchParams.get('book_id');
    const rawIds = u.searchParams.get('item_ids') ?? '';
    if (!bookId) return badRequest('缺少必要参数: book_id');
    if (!rawIds) return badRequest('缺少必要参数: item_ids');
    if (rawIds.startsWith('[')) {
      try { itemIds = JSON.parse(rawIds); }
      catch { return badRequest('item_ids参数格式错误'); }
    } else {
      itemIds = rawIds.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (itemIds.length === 0) return badRequest('item_ids参数不能为空');
  } else {
    return new Response(JSON.stringify({ success: false, error: '不支持的请求方法' }), {
      status: 405, headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  if (itemIds.length > 300) return badRequest('单次请求章节数量不能超过300个');

  try {
    // Refill CM keypair pool in background for next request.
    ctx.ctx.waitUntil(Promise.resolve().then(refillCMPool));

    const chapters = await withDeviceRetry(ctx, async (device) => {
      const cm = getCM();
      const handshakeKey = await cm.clientHandshake();
      const postBody = JSON.stringify({ book_id: bookId, item_ids: itemIds, key: handshakeKey });
      const url = buildUrl(device);
      const qs = new URL(url).search.slice(1);
      const sig = await signRequest(qs, postBody, ctx.sigOpts);

      const res = await fetch(url, {
        method: 'POST',
        body: postBody,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'user-agent': 'com.dragon.read',
          ...sig,
        },
      });
      if (isDeviceAuthFail(res.status)) throw new Error(`DEVICE_FAILED: HTTP ${res.status}`);
      if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);

      let parsed: FullResponse;
      try { parsed = await res.json() as FullResponse; }
      catch (e) { throw new Error(`JSON解析失败: ${(e as Error).message}`); }

      const itemInfos = parsed.data?.item_infos;
      if (!itemInfos) return [];

      const out: OutChapter[] = [];
      const entries = Array.isArray(itemInfos)
        ? itemInfos.map((v, k) => [String(k), v] as const)
        : Object.entries(itemInfos);
      const isAssoc = !Array.isArray(itemInfos);

      for (const [itemId, info] of entries) {
        const key = info.key ?? '';
        const content = info.content ?? '';
        const decrypted = await cm.decrypt(key, content);
        if (!decrypted) continue;
        const text = new TextDecoder().decode(decrypted);
        const formatted = processFullContent(text);
        const title = info.title ?? '';
        out.push(isAssoc ? { item_id: itemId, title, content: formatted } : { title, content: formatted });
      }
      return out;
    });
    return ok({ chapters });
  } catch (e) {
    return serverError((e as Error).message);
  }
}
