// Paragraph comment list for a chapter paragraph.
// Upstream returns plain JSON; no chapter-content AES decrypt is required.

import { signedFetch, ok, badRequest, serverError, type EndpointContext } from './base.js';

const COMMENT_LIST_URL = 'https://api5-normal-lf.fqnovel.com/reading/ugc/idea/comment_list/v/';
const DIGITS = /^\d+$/;

const OPTIONAL_KEYS = [
  'item_version',
  'version_code',
  'offset',
  'para_index',
  'count',
  'query_type',
  'sort',
  'aid',
] as const;

type OptionalKey = typeof OPTIONAL_KEYS[number];

const DEFAULTS: Record<OptionalKey, string> = {
  item_version: '0',
  version_code: '99999',
  offset: '0',
  para_index: '0',
  count: '100',
  query_type: '1',
  sort: '0',
  aid: '1967',
};

export async function handleCommentList(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const itemId = normalizeDigits(u.searchParams.get('item_id'));
  const bookId = normalizeDigits(u.searchParams.get('book_id'));
  if (!itemId) return badRequest('缺少item_id参数');
  if (!bookId) return badRequest('缺少book_id参数');

  const params = new URLSearchParams();
  for (const key of OPTIONAL_KEYS) {
    params.set(key, normalizeDigits(u.searchParams.get(key)) ?? DEFAULTS[key]);
  }
  params.set('item_id', itemId);
  params.set('book_id', bookId);

  const url = `${COMMENT_LIST_URL}?${params.toString()}`;

  try {
    const { status, text } = await signedFetch(url, ctx, {
      noSign: true,
      headers: {
        accept: 'application/json',
        'user-agent': 'com.dragon.read/66732',
      },
    });
    if (status !== 200) return serverError(`upstream HTTP ${status}`);

    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch (e) { return serverError(`JSON解析失败: ${(e as Error).message}`); }

    if (u.searchParams.get('raw') === '1') {
      return new Response(text, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
        },
      });
    }
    return ok(parsed);
  } catch (e) {
    return serverError((e as Error).message);
  }
}

function normalizeDigits(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  return DIGITS.test(normalized) ? normalized : null;
}
