// Directory — chapter list for a book. Two flavors:
//   1. ?api=directory                  — fqnovel.com all_items (needs device, filtered output)
//   2. ?api=directory&api_type=novel   — novel.snssdk.com with random device_id, returns book_info + item_list
// Mirrors final_php/DirectoryEndpoint.php.

import { signRequest } from '../signature.js';
import { fetchWithTimeout } from '../http.js';
import {
  withDeviceRetry,
  isDeviceAuthFail,
  signedFetch,
  ok,
  badRequest,
  serverError,
  type EndpointContext,
} from './base.js';

const FQNOVEL_BASE = 'https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/directory/all_items/v';
const NOVEL_BASE = 'https://novel.snssdk.com/api/novel/book/directory/list/v1/';

const FQNOVEL_STATIC_TAIL =
  '&ac=wifi&channel=xiaomi_1967_64&aid=1967&app_name=novelapp&version_code=65132' +
  '&version_name=6.5.1.32&device_platform=android&os=android&ssmix=a&device_type=FRD-AL10' +
  '&device_brand=honor&language=zh&os_api=28&os_version=9&manifest_version_code=65132' +
  '&resolution=1080*1920&dpi=480&update_version_code=65132&pv_player=65132&=' +
  '&need_personal_recommend=1&player_so_load=1&is_android_pad_screen=0&host_abi=arm64-v8a' +
  '&dragon_device_type=phone&rom_version=FRD-AL10+8.0.0.556%28C00%29&compliance_status=0';

const NOVEL_STATIC_TAIL =
  '&aid=13&device_type=25053RT47C&os_version=15&openudid=5ee878397ab439b3' +
  '&manifest_version_code=708&update_version_code=70899';

function randomDeviceId(length = 16): string {
  let s = '';
  for (let i = 0; i < length; i++) s += Math.floor(Math.random() * 10).toString();
  return s;
}

export async function handleDirectory(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  let bookId = u.searchParams.get('book_id');
  if (!bookId && req.method === 'POST') {
    try {
      const body = await req.clone().formData();
      bookId = (body.get('book_id') as string) ?? null;
    } catch {/* ignore */}
  }
  if (!bookId) return badRequest('缺少book_id参数', '请提供小说ID');

  const apiType = u.searchParams.get('api_type') ?? 'reading';
  return apiType === 'novel'
    ? getNovelDirectory(bookId, ctx)
    : getFqnovelDirectory(bookId, ctx);
}

async function getFqnovelDirectory(bookId: string, ctx: EndpointContext): Promise<Response> {
  try {
    const result = await withDeviceRetry(ctx, async (device) => {
      const url =
        `${FQNOVEL_BASE}?book_type=0&item_data_list_md5=&catalog_data_md5=` +
        `&book_id=${encodeURIComponent(bookId)}&book_info_md5=&need_version=true` +
        `&device_id=${device.device_id}${FQNOVEL_STATIC_TAIL}`;
      const queryString = new URL(url).search.slice(1);
      const sig = await signRequest(queryString, null, ctx.sigOpts);

      const res = await fetchWithTimeout(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13)', ...sig },
      });
      if (isDeviceAuthFail(res.status)) throw new Error(`DEVICE_FAILED: HTTP ${res.status}`);
      if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);

      const text = await res.text();
      let parsed: { data?: { item_data_list?: Array<{ title?: string; item_id?: string; version?: string }> } };
      try { parsed = JSON.parse(text); }
      catch (e) { throw new Error(`JSON解析失败: ${(e as Error).message}`); }

      const items = parsed.data?.item_data_list ?? [];
      const lists = items.map((it) => ({
        title: it.title ?? '',
        item_id: it.item_id ?? '',
        version: it.version ?? '',
      }));
      return { lists };
    });
    return ok(result);
  } catch (e) {
    return serverError((e as Error).message);
  }
}

async function getNovelDirectory(bookId: string, ctx: EndpointContext): Promise<Response> {
  const url =
    `${NOVEL_BASE}?app_name=news_article&version_name=7.0.8&app_version=7.0.8` +
    `&device_id=${randomDeviceId()}&channel=tt_huawei2019_yz&version_code=708` +
    `&device_platform=android&parent_enterfrom=&book_id=${encodeURIComponent(bookId)}` +
    NOVEL_STATIC_TAIL;

  try {
    const { status, text } = await signedFetch(url, ctx, {
      headers: { 'user-agent': 'com.ss.android.article.news' },
    });
    if (status !== 200) return serverError(`upstream HTTP ${status}`);

    let parsed: {
      data?: {
        book_info?: { abstract?: string; author?: string; book_id?: string; book_name?: string; thumb_url?: string };
        item_list?: unknown[];
      };
    };
    try { parsed = JSON.parse(text); }
    catch (e) { return serverError(`API响应解析失败: ${(e as Error).message}`); }

    const info = parsed.data?.book_info;
    if (!info || !parsed.data?.item_list) return ok(null);

    return ok({
      abstract: info.abstract ?? '',
      author: info.author ?? '',
      book_id: info.book_id ?? '',
      book_name: info.book_name ?? '',
      thumb_url: info.thumb_url ?? '',
      item_list: parsed.data.item_list ?? [],
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
}
