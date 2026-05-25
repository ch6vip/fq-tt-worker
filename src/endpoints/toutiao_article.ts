// toutiao_article — currently a password-gated "now" endpoint.
// Mirrors final_php/ToutiaoArticleEndpoint.php :: handle().
//
// Note: PHP also defines getArticleContent/extractContentFromSSR/etc but
// handle() doesn't call them — the decompiler captured a stub state. If the
// full article fetching path comes back online in PHP, mirror it here.

import { ok, badRequest } from './base.js';

export function handleToutiaoArticle(req: Request, authPassword?: string): Response {
  const u = new URL(req.url);
  const password = u.searchParams.get('password');
  const expected = authPassword ?? 'tutu0209';
  if (password !== expected) {
    return new Response(JSON.stringify({ success: false, error: '密码错误或缺少密码' }), {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const now = Math.floor(Date.now() / 1000);
  return ok({
    now,
    now_formatted: new Date(now * 1000).toISOString().replace('T', ' ').slice(0, 19),
  });
}
