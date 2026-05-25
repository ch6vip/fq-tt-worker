// wkcontent — audio speech timeline for an item_id/video_id.
// Mirrors final_php/WkcontentEndpoint.php (115 lines).

import { signRequest } from '../signature.js';
import {
  withDeviceRetry,
  isDeviceAuthFail,
  ok,
  badRequest,
  serverError,
  type EndpointContext,
} from './base.js';

const URL_BASE = 'https://api-sinfonlinea.fanqiesdk.com/api/novel/audio/speech/text/v1/';

// Long static tail captured from PHP. Includes ab_group/ab_feature variants
// plus a trailing &device_id= which we fill in per-request.
const STATIC_TAIL =
  '&device_platform=android&os=android&ssmix=a&aid=6589&app_name=gold_browser' +
  '&version_code=150800&version_name=15.8.0&manifest_version_code=15800' +
  '&update_version_code=158004&ab_group=94569,102754&ab_feature=94563,102749' +
  '&resolution=1080*1920&dpi=480&device_type=FRD-AL10&device_brand=honor' +
  '&language=zh&os_api=28&os_version=9&ac=wifi&current_launch_mode=enter_launch' +
  '&pass_through=update64&recommend_switch=true&current_launch_mode_hot=enter_launch' +
  '&is_db=0&today_first_launch_mode=enter_launch&dq_param=1&is...&device_id=';

const HEADERS_BASE = {
  'user-agent': 'com.cat.readall/15800 (Linux; U; Android 9; zh_CN; FRD-AL10; Build/HUAWEIFRD-AL10; Cronet/TTNetVersion:fc4cebd3 2024-12-10 QuicVersion:d9628e3d 2024-10-11)',
  'sdk-version': '2',
  'passport-sdk-version': '505317',
  'x-vc-bdturing-sdk-version': '4.0.3.cn',
  'x-tt-request-tag': 'n=0;s=1;p=0',
  'x-ss-dp': '6589',
};

export async function handleWkcontent(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const itemIds = u.searchParams.get('video_id') ?? u.searchParams.get('item_ids');
  if (!itemIds) return badRequest('缺少video_id参数');
  const genre = u.searchParams.get('genre') ?? '4';
  const toneId = u.searchParams.get('tone_id') ?? '99';

  try {
    const text = await withDeviceRetry(ctx, async (device) => {
      const url =
        `${URL_BASE}?item_id=${encodeURIComponent(itemIds)}&genre=${encodeURIComponent(genre)}` +
        `&tone_id=${encodeURIComponent(toneId)}${STATIC_TAIL}${device.device_id}`;
      const qs = new URL(url).search.slice(1);
      const sig = await signRequest(qs, null, ctx.sigOpts);
      const res = await fetch(url, { headers: { ...HEADERS_BASE, ...sig } });
      if (isDeviceAuthFail(res.status)) throw new Error(`DEVICE_FAILED: HTTP ${res.status}`);
      if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
      return res.text();
    });
    try { return ok(JSON.parse(text)); }
    catch { return ok(text); }
  } catch (e) {
    return serverError((e as Error).message);
  }
}
