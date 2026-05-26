// Search — two modes:
//   1. ?api=search                — query fqnovel.com (needs device pool)
//   2. ?api=search&search_type=fanqie — query fanqiesdk.com (gzip response, no device)
// Mirrors final_php/SearchEndpoint.php.

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

const FQNOVEL_BASE = 'https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/search/tab/v/';
const FANQIE_BASE = 'https://api.fanqiesdk.com/api/novel/channel/homepage/search/search/v1/';

// Static params for both flavors.
const FQNOVEL_STATIC: Record<string, string> = {
  bookshelf_search_plan: '4',
  user_is_login: '1',
  bookstore_tab: '2',
  search_source: '1',
  clicked_content: 'search_history',
  use_lynx: 'false',
  use_correct: 'true',
  tab_name: 'store',
  pad_column_cover: '0',
  is_first_enter_search: 'false',
  ac: 'wifi',
  channel: 'xiaomi_1967_64',
  aid: '1967',
  app_name: 'novelapp',
  version_code: '65132',
  version_name: '6.5.1.32',
  device_platform: 'android',
  os: 'android',
  ssmix: 'a',
  device_type: 'FRD-AL10',
  device_brand: 'honor',
  language: 'zh',
  os_api: '28',
  os_version: '9',
  manifest_version_code: '65132',
  resolution: '1080*1920',
  dpi: '480',
  update_version_code: '65132',
  pv_player: '65132',
  gender: '2',
  need_personal_recommend: '1',
  player_so_load: '1',
  is_android_pad_screen: '0',
  host_abi: 'arm64-v8a',
  dragon_device_type: 'phone',
  rom_version: 'FRD-AL10+8.0.0.556(C00)',
  compliance_status: '0',
};

const FANQIE_QUERY_TAIL =
  '&enterfrom_aid=&enter_from=inner_search&app_name=news_article&version_name=7.0.8&app_version=7.0.8' +
  '&channel=tt_huawei2019_yz&version_code=708&device_platform=android&parent_enterfrom=novel_list' +
  '&novel_host=&aid=13&scm_version=1.0.0.4112&device_type=25053RT47C&device_brand=Redmi&language=zh' +
  '&os_api=35&os_version=15&openudid=5ee878397ab439b3&update_version_code=70899&plugin=0' +
  '&tma_jssdk_version=1.10.0.0&rom_version=miui__os2.0.209.0.volcnxm';

const NEWS_UA =
  'com.ss.android.article.news/13400 (Linux; U; Android 10; zh_CN; tb8788p1_64_bsp; ' +
  'Build/QQ3A.200805.001; Cronet/TTNetVersion:fc4cebd3 2024-12-10 QuicVersion:d9628e3d 2024-10-11)';

const FANQIE_KEEP_FIELDS = ['abstract', 'author', 'book_id', 'category', 'creation_status', 'genre', 'thumb_url', 'title'] as const;

export async function handleSearch(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const searchType = u.searchParams.get('search_type') ?? 'reading';

  if (searchType === 'fanqie') {
    const q = u.searchParams.get('q');
    if (!q) return badRequest('缺少搜索关键词参数q');
    const offset = u.searchParams.get('offset') ?? '0';
    return handleFanqieSearch(q, offset, ctx);
  }

  const query = u.searchParams.get('query');
  if (!query) return badRequest('缺少搜索关键词参数query');
  const offset = u.searchParams.get('offset') ?? '0';
  const count = u.searchParams.get('count') ?? '0';
  const tabType = u.searchParams.get('tab_type') ?? '0';
  const passback = u.searchParams.get('passback') ?? offset;
  return handleReadingSearch(query, offset, count, tabType, passback, ctx);
}

async function handleReadingSearch(
  query: string,
  offset: string,
  count: string,
  tabType: string,
  passback: string,
  ctx: EndpointContext,
): Promise<Response> {
  try {
    const data = await withDeviceRetry(ctx, async (device) => {
      const params = new URLSearchParams();
      // Order matters less for fqnovel.com (server doesn't enforce), but to match
      // the PHP key sequence for predictability we add in the same order it does.
      params.set('offset', offset);
      params.set('passback', passback);
      params.set('query', query);
      params.set('count', count);
      params.set('tab_type', tabType);
      for (const [k, v] of Object.entries(FQNOVEL_STATIC)) params.set(k, v);
      params.set('iid', device.install_id);
      params.set('device_id', device.device_id);

      const queryString = params.toString();
      const url = `${FQNOVEL_BASE}?${queryString}`;
      const sig = await signRequest(queryString, null, ctx.sigOpts);

      const res = await fetchWithTimeout(url, {
        headers: { 'user-agent': 'com.dragon.read', ...sig },
      });
      if (isDeviceAuthFail(res.status)) throw new Error(`DEVICE_FAILED: HTTP ${res.status}`);
      if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);

      const text = await res.text();
      try { return JSON.parse(text); }
      catch { throw new Error('API响应解析失败'); }
    });
    return ok(data);
  } catch (e) {
    return serverError((e as Error).message);
  }
}

async function handleFanqieSearch(q: string, offset: string, ctx: EndpointContext): Promise<Response> {
  const url = `${FANQIE_BASE}?q=${encodeURIComponent(q)}&offset=${encodeURIComponent(offset)}${FANQIE_QUERY_TAIL}`;
  try {
    const { status, text } = await signedFetch(url, ctx, {
      headers: {
        'user-agent': NEWS_UA,
        'accept-encoding': 'gzip, deflate',
      },
    });
    if (status !== 200) return serverError(`upstream HTTP ${status}`);

    // Strip control bytes that occasionally sneak in.
    const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    let parsed: { data?: { ret_data?: Record<string, unknown>[] } };
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      return serverError(`API响应解析失败: ${(e as Error).message} | 响应前100字符: ${cleaned.slice(0, 100)}`);
    }

    const items = Array.isArray(parsed.data?.ret_data) ? parsed.data!.ret_data! : [];
    const filtered = items.map((item) => {
      const out: Record<string, unknown> = {};
      for (const f of FANQIE_KEEP_FIELDS) out[f] = item[f] ?? '';
      return out;
    });
    return ok(filtered);
  } catch (e) {
    return serverError((e as Error).message);
  }
}
