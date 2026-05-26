// book — fanqienovel.com web-side reader directory detail.
// Mirrors final_php/BookEndpoint.php — uses ABogus signature (not Argus/Gorgon).

import { generateABogus } from '../crypto/abogus.js';
import { ok, badRequest, serverError, type EndpointContext } from './base.js';

const URL_BASE = 'https://fanqienovel.com/api/reader/directory/detail';
const CHROME_UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/136.0.0.0 Mobile Safari/537.36';

const MSTOKEN_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function generateMsToken(length = 182): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += MSTOKEN_CHARS[Math.floor(Math.random() * MSTOKEN_CHARS.length)];
  }
  return encodeURIComponent(s);
}

export async function handleBook(req: Request, _ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const bookId = u.searchParams.get('book_id') ?? u.searchParams.get('item_ids');
  if (!bookId) return badRequest('缺少book_id参数');

  const queryString = `bookId=${bookId}`;
  const aBogus = generateABogus(queryString, CHROME_UA);
  const msToken = generateMsToken();
  const url = `${URL_BASE}?${queryString}&msToken=${msToken}&a_bogus=${encodeURIComponent(aBogus)}`;

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': CHROME_UA, accept: 'application/json' },
    });
    if (!res.ok) return serverError(`upstream HTTP ${res.status}`);
    const text = await res.text();
    try { return ok(withChapterBookId(JSON.parse(text), bookId)); }
    catch { return ok(text); }
  } catch (e) {
    return serverError((e as Error).message);
  }
}

function withChapterBookId(payload: unknown, bookId: string): unknown {
  if (!payload || typeof payload !== 'object') return payload;

  const root = payload as {
    data?: {
      chapterListWithVolume?: unknown;
    };
  };
  const volumes = root.data?.chapterListWithVolume;
  if (!Array.isArray(volumes)) return payload;

  root.data!.chapterListWithVolume = volumes.map((volume) => {
    if (!Array.isArray(volume)) return volume;
    return volume.map((chapter) => {
      if (!chapter || typeof chapter !== 'object') return chapter;
      return { ...chapter, book_id: bookId, bookId };
    });
  });

  return payload;
}
