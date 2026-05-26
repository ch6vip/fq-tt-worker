// Chapter content fetch + AES decrypt + HTML cleanup.
// Mirrors final_php/ExactContentEndpoint.php — but only the main 'full'/'batch'
// paths are ported. The PHP audio/detail/comment/novel-content branches stay
// TODO; they're separate upstream APIs and can be added later.
//
// Modes (driven by query):
//   ?api=content&item_ids=...              — single chapter (or batch if commas)
//   ?api=content&item_ids=A,B,C            — batch (forces batch_full upstream)
//   ?api=content&api_type=batch&...        — forced batch
//   ?api=content&api_type=...&custom_url=  — override URL template with
//                                            {$zwkey2} and {$item_id} placeholders
//
// Not yet ported: ts=听书 (audio), comment=评论 (comments), api_type=novel.

import { signRequest } from '../signature.js';
import { fetchWithTimeout } from '../http.js';
import { RUNTIME_CONFIG } from '../config.js';
import {
  withDeviceRetry,
  isDeviceAuthFail,
  decryptResponse,
  ok,
  badRequest,
  serverError,
  type EndpointContext,
} from './base.js';
import { parseDigitIdList } from './params.js';
import type { Device } from '../device/pool.js';

const FULL_URL_BASE = 'https://reading.snssdk.com/reading/reader/full/v/';
const BATCH_URL_BASE = 'https://api5-normal-sinfonlineb.fqnovel.com/reading/reader/batch_full/v';

interface ChapterApiResponse {
  data?:
    | { content?: string; title?: string }                                    // full
    | Record<string, { content?: string; title?: string; novel_data?: { title_from_article?: string } }>; // batch
}

interface ChapterOut {
  title?: string;
  content: string;
}

export async function handleContent(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const parsedItemIds = parseDigitIdList(
    u.searchParams.get('item_ids'),
    'item_ids',
    RUNTIME_CONFIG.parameterLimits.contentMaxItemIds,
  );
  if ('response' in parsedItemIds) return parsedItemIds.response;
  const itemIds = parsedItemIds.value;

  const apiTypeReq = u.searchParams.get('api_type') ?? 'full';
  const customUrl = u.searchParams.get('custom_url') ?? '';
  const ts = u.searchParams.get('ts');
  const comment = u.searchParams.get('comment');

  // Unsupported branches — fail loudly rather than mis-route.
  if (ts === '听书')                          return badRequest('audio (ts=听书) not yet ported');
  if (apiTypeReq === 'novel')                 return badRequest('api_type=novel not yet ported');
  if (comment === '评论')                      return badRequest('book comment not yet ported');

  const isBatch = itemIds.includes(',') || apiTypeReq === 'batch';
  const apiType = isBatch ? 'batch' : apiTypeReq;

  try {
    const result = isBatch
      ? await handleBatch(itemIds, apiType, customUrl, ctx)
      : await handleSingle(itemIds, apiType, customUrl, ctx);
    return ok(result);
  } catch (e) {
    return serverError((e as Error).message);
  }
}

async function handleSingle(
  itemId: string,
  apiType: string,
  customUrl: string,
  ctx: EndpointContext,
): Promise<ChapterOut> {
  return await withDeviceRetry(ctx, async (device) => {
    const url = buildRequestUrl(itemId, device, apiType, customUrl);
    const resp = await makeChapterRequest(url, ctx);
    const result = await processChapterResponse(resp, device.secret_key, apiType, url, true);
    // handleSingle only takes the full-path branch, which always returns ChapterOut.
    return Array.isArray(result) ? result[0]! : result;
  });
}

async function handleBatch(
  itemIds: string,
  apiType: string,
  customUrl: string,
  ctx: EndpointContext,
): Promise<{ chapters: ChapterOut[]; failed: Array<{ item_id: string; error: string }> }> {
  const ids = itemIds.split(',').map(s => s.trim()).filter(Boolean);
  const chapters: ChapterOut[] = [];
  const failed: Array<{ item_id: string; error: string }> = [];

  // PHP loops items serially. We do the same — keeps device pool pressure
  // bounded and lets each item retry with a fresh device cleanly.
  for (const id of ids) {
    try {
      const one = await withDeviceRetry(ctx, async (device) => {
        const url = buildRequestUrl(id, device, apiType, customUrl);
        const resp = await makeChapterRequest(url, ctx);
        return processChapterResponse(resp, device.secret_key, apiType, url);
      });
      // batch_full may return either a list of chapters or a single object
      if (Array.isArray(one)) chapters.push(...(one as ChapterOut[]));
      else chapters.push(one as ChapterOut);
    } catch (e) {
      failed.push({ item_id: id, error: (e as Error).message.replace('DEVICE_FAILED: ', '') });
    }
  }
  return { chapters, failed };
}

function buildRequestUrl(
  itemId: string,
  device: Device,
  apiType: string,
  customUrl: string,
): string {
  if (customUrl) {
    return customUrl
      .replaceAll('{$zwkey2}', device.device_id)
      .replaceAll('{$item_id}', itemId);
  }
  if (apiType === 'full') {
    return (
      `${FULL_URL_BASE}?aid=1967&app_name=novelapp&channel=0&device_platform=android` +
      `&device_id=${device.device_id}&device_type=Honor10&item_id=${encodeURIComponent(itemId)}` +
      `&os_version=0&version_code=66.9`
    );
  }
  return (
    `${BATCH_URL_BASE}?aid=1967&app_name=novelapp&channel=0&device_platform=android` +
    `&device_id=${device.device_id}&device_type=Honor10&os_version=0&version_code=66.9` +
    `&book_id=0&item_ids=${encodeURIComponent(itemId)}&novel_text_type=1&req_type=1`
  );
}

async function makeChapterRequest(url: string, ctx: EndpointContext): Promise<ChapterApiResponse> {
  const queryString = new URL(url).search.slice(1);
  const sig = await signRequest(queryString, null, ctx.sigOpts);
  const res = await fetchWithTimeout(url, { headers: { 'user-agent': 'com.dragon.read', ...sig } });
  if (isDeviceAuthFail(res.status)) throw new Error(`DEVICE_FAILED: HTTP ${res.status}`);
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  try { return await res.json() as ChapterApiResponse; }
  catch (e) { throw new Error(`JSON解析失败: ${(e as Error).message}`); }
}

async function processChapterResponse(
  responseData: ChapterApiResponse,
  secretKey: string,
  apiType: string,
  url: string,
  retryOnBadPayload = false,
): Promise<ChapterOut | ChapterOut[]> {
  const isFullPath = apiType === 'full' || url.includes('/full/v/');

  if (isFullPath) {
    const data = (responseData.data ?? {}) as { content?: string };
    if (!data.content) throw new Error(retryOnBadPayload ? 'DEVICE_FAILED: 响应中缺少data.content字段' : '响应中缺少data.content字段');
    let decrypted: Uint8Array;
    try {
      decrypted = await decryptResponse(data.content, secretKey);
    } catch (e) {
      const message = (e as Error).message;
      if (retryOnBadPayload && /payload too short|decryptResponse|AES|decrypt/i.test(message)) {
        throw new Error(`DEVICE_FAILED: ${message}`);
      }
      throw e;
    }
    const text = new TextDecoder().decode(decrypted);
    return { content: processContent(text) };
  }

  // batch path — data is an object keyed by item_id
  const data = responseData.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('响应中缺少data字段或格式不正确');
  }

  const out: ChapterOut[] = [];
  for (const info of Object.values(data) as Array<{ content?: string; title?: string; novel_data?: { title_from_article?: string } }>) {
    if (!info?.content) continue;
    try {
      const decrypted = await decryptResponse(info.content, secretKey);
      const text = new TextDecoder().decode(decrypted);
      const title = info.title ?? info.novel_data?.title_from_article ?? '';
      out.push({ title, content: processContent(text) });
    } catch (e) {
      // Skip undecryptable chapters but keep going.
      console.warn('chapter decrypt failed:', (e as Error).message);
    }
  }
  if (out.length === 0) throw new Error('所有章节均无内容');
  return out;
}

// HTML cleanup. Mirrors BaseEndpoint::processContent + ExactContentEndpoint's
// stricter variant (drops <div>, <header>...</header> etc).
const CONTENT_STRIP_PATTERNS: RegExp[] = [
  /<p class="pictureDesc" group-id="\d+" idx="\d+">/g,
  /<\/body>|<\/html>|<\/div>/g,
  /<div[^>]*>/g,
  /<p class="picture" group-id="\d+">/g,
  /<div data-fanqie-type="image" source="user">/g,
  /<head>.*<\/h1>/gs,
  /<!DOCTYPE.*<html>/gs,
  /<\?xml.*\?>/gs,
  /<p idx="\d+">/g,
  /<header>.*<\/header>/gs,
  /<article>|<\/article>/g,
  /<footer>|<\/footer>/g,
  /<tt_keyword.*keyword_ad>/g,
  /<p>/g,
];

function processContent(content: string): string {
  let out = content;
  for (const p of CONTENT_STRIP_PATTERNS) { p.lastIndex = 0; out = out.replace(p, ''); }
  out = out.replace(/&amp;x/g, '&x');
  out = out.replace(/<\/p>/g, '\n');
  return out.trim();
}
