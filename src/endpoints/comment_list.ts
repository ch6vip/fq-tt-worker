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
  const fetched = await fetchCommentList(req, ctx);
  if ('response' in fetched) return fetched.response;

  if (u.searchParams.get('raw') === '1') {
    return new Response(fetched.text, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      },
    });
  }
  return ok(fetched.parsed);
}

export async function handleCommentPage(req: Request, ctx: EndpointContext): Promise<Response> {
  const fetched = await fetchCommentList(req, ctx);
  if ('response' in fetched) return fetched.response;

  return new Response(renderCommentPage(fetched.parsed), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    },
  });
}

async function fetchCommentList(req: Request, ctx: EndpointContext): Promise<
  { text: string; parsed: unknown } | { response: Response }
> {
  const u = new URL(req.url);
  const itemId = normalizeDigits(u.searchParams.get('item_id'));
  const bookId = normalizeDigits(u.searchParams.get('book_id'));
  if (!itemId) return { response: badRequest('缺少item_id参数') };
  if (!bookId) return { response: badRequest('缺少book_id参数') };

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
    if (status !== 200) return { response: serverError(`upstream HTTP ${status}`) };

    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch (e) { return { response: serverError(`JSON解析失败: ${(e as Error).message}`) }; }

    return { text, parsed };
  } catch (e) {
    return { response: serverError((e as Error).message) };
  }
}

function normalizeDigits(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  return DIGITS.test(normalized) ? normalized : null;
}

function renderCommentPage(payload: unknown): string {
  const root = payload as {
    data?: {
      para_src_content?: string;
      comments?: Array<{
        text?: string;
        digg_count?: number;
        reply_count?: number;
        create_timestamp?: number;
        user_info?: { user_name?: string; user_avatar?: string; is_author?: boolean };
        detail_reply_list?: Array<{
          text?: string;
          create_timestamp?: number;
          user_info?: { user_name?: string; is_author?: boolean };
        }>;
        reply_list?: Array<{
          text?: string;
          create_timestamp?: number;
          user_info?: { user_name?: string; is_author?: boolean };
        }>;
      }>;
    };
  };
  const data = root.data ?? {};
  const comments = Array.isArray(data.comments) ? data.comments : [];
  const items = comments.map((comment) => {
    const user = comment.user_info ?? {};
    const replies = comment.detail_reply_list ?? comment.reply_list ?? [];
    return `
      <article class="comment">
        <div class="meta">
          ${user.user_avatar ? `<img class="avatar" src="${escapeAttr(user.user_avatar)}" alt="">` : '<span class="avatar empty"></span>'}
          <div>
            <div class="name">${escapeHtml(user.user_name || '匿名')}${user.is_author ? '<span class="tag">作者</span>' : ''}</div>
            <div class="time">${formatTime(comment.create_timestamp)}</div>
          </div>
        </div>
        <p>${escapeHtml(comment.text || '')}</p>
        <div class="stats">赞 ${Number(comment.digg_count ?? 0)} · 回复 ${Number(comment.reply_count ?? replies.length)}</div>
        ${renderReplies(replies)}
      </article>`;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>段评</title>
  <style>
    body{margin:0;background:#f6f6f6;color:#202124;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.55}
    header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e8eaed;padding:12px 14px;z-index:1}
    h1{font-size:17px;margin:0 0 6px}
    .para{color:#5f6368;font-size:13px;white-space:pre-wrap}
    main{padding:10px}
    .comment{background:#fff;border:1px solid #e8eaed;border-radius:8px;margin:0 0 10px;padding:12px}
    .meta{display:flex;gap:10px;align-items:center}
    .avatar{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#e8eaed;flex:0 0 auto}
    .name{font-weight:600}
    .time,.stats{font-size:12px;color:#6b7280}
    .tag{font-size:11px;color:#b45309;background:#fff3d6;border-radius:4px;margin-left:6px;padding:1px 4px}
    p{margin:10px 0;white-space:pre-wrap}
    .reply{border-left:3px solid #e8eaed;margin:8px 0 0;padding:7px 0 4px 9px;color:#3c4043}
    .empty-text{text-align:center;color:#6b7280;padding:48px 12px}
  </style>
</head>
<body>
  <header>
    <h1>段评 ${comments.length ? `(${comments.length})` : ''}</h1>
    ${data.para_src_content ? `<div class="para">${escapeHtml(data.para_src_content)}</div>` : ''}
  </header>
  <main>${items || '<div class="empty-text">这段暂时没有段评</div>'}</main>
</body>
</html>`;
}

function renderReplies(replies: Array<{ text?: string; create_timestamp?: number; user_info?: { user_name?: string; is_author?: boolean } }>): string {
  if (!replies.length) return '';
  return replies.slice(0, 3).map((reply) => {
    const user = reply.user_info ?? {};
    return `<div class="reply"><strong>${escapeHtml(user.user_name || '匿名')}${user.is_author ? ' · 作者' : ''}</strong>：${escapeHtml(reply.text || '')}<div class="time">${formatTime(reply.create_timestamp)}</div></div>`;
  }).join('');
}

function formatTime(value?: number): string {
  if (!value) return '';
  return new Date(value * 1000).toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
