// Book share — share info + excerpts list for a book.
// Mirrors final_php/BookShareEndpoint.php.
//
// modes:
//   share    — only share/info upstream
//   excerpt  — only excerpt/list upstream
//   both     — both, merged response (default)

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
import type { Device } from '../device/pool.js';

const SHARE_URL = 'https://api5-normal-sinfonlineb.fqnovel.com/reading/user/share/info/v';
const EXCERPT_URL = 'https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/excerpt/list/v';

const SHARE_TAIL =
  '&only_share_status=false&status=0&ac=wifi&channel=xiaomi_1967_64&aid=1967&app_name=novelapp' +
  '&version_code=65132&version_name=6.5.1.32&device_platform=android&os=android&ssmix=a' +
  '&device_type=FRD-AL10&device_brand=honor&language=zh&os_api=28&os_version=9' +
  '&manifest_version_code=65132&resolution=1080*1920&dpi=480&update_version_code=65132' +
  '&pv_player=65132&gender=2&need_personal_recommend=1&player_so_load=1&is_android_pad_screen=0' +
  '&host_abi=arm64-v8a&dragon_device_type=phone&rom_version=FRD-AL10+8.0.0.556...';

const EXCERPT_TAIL =
  '&ac=wifi&channel=xiaomi_1967_64&aid=1967&app_name=novelapp&version_code=65132' +
  '&version_name=6.5.1.32&device_platform=android&os=android&ssmix=a&device_type=FRD-AL10' +
  '&device_brand=honor&language=zh&os_api=28&os_version=9&manifest_version_code=65132' +
  '&resolution=1080*1920&dpi=480&update_version_code=65132&pv_player=65132&=' +
  '&need_personal_recommend=1&player_so_load=1&is_android_pad_screen=0&host_abi=arm64-v8a' +
  '&dragon_device_type=phone&rom_version=FRD-AL10+8.0.0.556%28C00%29&compliance_status=0';

async function fetchSigned(url: string, ctx: EndpointContext): Promise<string> {
  const qs = new URL(url).search.slice(1);
  const sig = await signRequest(qs, null, ctx.sigOpts);
  const res = await fetchWithTimeout(url, { headers: { 'user-agent': 'com.dragon.read', ...sig } });
  if (isDeviceAuthFail(res.status)) throw new Error(`DEVICE_FAILED: HTTP ${res.status}`);
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  return res.text();
}

export async function handleBookShare(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const bookId = u.searchParams.get('book_id');
  if (!bookId) return badRequest('缺少book_id参数');
  const mode = u.searchParams.get('mode') ?? 'both';

  const buildShareUrl = () => `${SHARE_URL}?tone_id=0&share_type=0&group_id=${encodeURIComponent(bookId)}${SHARE_TAIL}`;
  const buildExcerptUrl = (d: Device) =>
    `${EXCERPT_URL}?limit=0&book_id=${encodeURIComponent(bookId)}&iid=${d.install_id}&device_id=${d.device_id}${EXCERPT_TAIL}`;

  try {
    return await withDeviceRetry(ctx, async (device) => {
      let shareResp: string | null = null;
      let excerptResp: string | null = null;

      if (mode === 'share' || mode === 'both') shareResp = await fetchSigned(buildShareUrl(), ctx);
      if (mode === 'excerpt' || mode === 'both') excerptResp = await fetchSigned(buildExcerptUrl(device), ctx);

      if (mode === 'share') return rawOk(shareResp!);
      if (mode === 'excerpt') return rawOk(excerptResp!);

      let shareData: unknown, excerptData: unknown;
      try {
        shareData = JSON.parse(shareResp!);
        excerptData = JSON.parse(excerptResp!);
      } catch {
        throw new Error('JSON解析失败');
      }
      return ok({ share_info: shareData, excerpts: excerptData });
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
}

function rawOk(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
