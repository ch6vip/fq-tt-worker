// toutiao_article — "now" timestamp endpoint.
// Mirrors final_php/ToutiaoArticleEndpoint.php :: handle().
//
// Note: PHP also defines getArticleContent/extractContentFromSSR/etc but
// handle() doesn't call them — the decompiler captured a stub state. If the
// full article fetching path comes back online in PHP, mirror it here.

import { ok } from './base.js';

export function handleToutiaoArticle(_req: Request): Response {
  const now = Math.floor(Date.now() / 1000);
  return ok({
    now,
    now_formatted: new Date(now * 1000).toISOString().replace('T', ' ').slice(0, 19),
  });
}
