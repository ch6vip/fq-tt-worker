// item_info — book/chapter directory detail.
// Mirrors final_php/ItemInfoEndpoint.php (68 lines).
//
// Quirk: this endpoint uses aid=1319 (not the global 1967). The signature
// layer reads aid from the query string when present, so this just works.

import { signedFetch, ok, badRequest, serverError, type EndpointContext } from './base.js';

const URL_TEMPLATE = 'https://novel.snssdk.com/api/novel/book/directory/detail/v/';
const ITEM_IDS_PATTERN = /^\d+(,\d+)*$/;

const SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

export async function handleItemInfo(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const raw = u.searchParams.get('item_ids');
  if (!raw) {
    return badRequest('缺少item_ids参数', '?item_ids=7507512821328904729,7507960973773242905');
  }
  const itemIds = raw.replace(/\s+/g, '').replace(/^,+|,+$/g, '');
  if (!ITEM_IDS_PATTERN.test(itemIds)) {
    return badRequest('item_ids参数格式不正确', '逗号分隔的数字ID');
  }

  const url = `${URL_TEMPLATE}?aid=1319&item_ids=${encodeURIComponent(itemIds)}`;

  try {
    const { status, text } = await signedFetch(url, ctx, {
      headers: {
        'user-agent': SAFARI_UA,
        accept: 'application/json',
        referer: 'https://novel.snssdk.com/',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    if (status !== 200) return serverError(`upstream HTTP ${status}`);

    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return new Response(`JSON解析失败，原始响应：\n${text}`, { status: 502 }); }

    return ok({ http_code: 200, data: parsed });
  } catch (e) {
    return serverError((e as Error).message);
  }
}
