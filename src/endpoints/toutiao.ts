// toutiao — chapter content from novel.snssdk.com with DH-encrypted response.
// Mirrors final_php/ToutiaoEndpoint.php.
//
// Protocol:
//   - Client picks a 256-bit private key `a`, computes A = g^a mod p (1024-bit p, g=2)
//   - Sends y = base64(iv || AES-128-CBC-zero(A_bytes, fixed_key, iv)) as header
//   - Server responds with header y' = base64(B_bytes), c flag
//   - If c == '1': content is base64(iv || ciphertext), decrypt with AES-256-CBC
//     using key = B^a mod p (32 raw bytes from the shared secret).
//   - Otherwise: content is just base64-encoded.

import { signRequest } from '../signature.js';
import { ok, badRequest, serverError, type EndpointContext } from './base.js';

// 1024-bit safe prime captured from PHP (gmp_init decimal string).
const DH_P = 2410312426921032588552076022197566074856950548502459942654116941958108831682612228890093858261341614673227141477904012196503648957050582631942730706805009223062734745341073406696246014589361659774041027169249453200378729434170325843778659198143763193776859869524088940195577346119843545301547043747207749969763750084308926339295559968882457872412993810129130294592999947926365264059284647209730384947211681434464714438488520940127459844288859336526896320919633919n;
const DH_G = 2n;

// Same AES-128-CBC key used by androidRegisterKeyAndGetSecret.
const Y_HEADER_KEY = base64ToBytes('rCXGfd2POMGzeiNIgo4iLg==');

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let r = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return r;
}

function bigIntToJavaBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array();
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  if (arr[0]! & 0x80) {
    // Prepend 0x00 so the high bit isn't interpreted as a sign bit (Java BigInteger convention).
    const out = new Uint8Array(arr.length + 1);
    out.set(arr, 1);
    return out;
  }
  return arr;
}

function javaBytesToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

function stripLeadingZeros(b: Uint8Array): number {
  let i = 0;
  while (i < b.length && b[i] === 0) i++;
  return i;
}

function pkcs7Pad(data: Uint8Array, block = 16): Uint8Array {
  const pad = block - (data.length % block);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
}

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  const pad = data[data.length - 1]!;
  if (pad < 1 || pad > 16 || pad > data.length) throw new Error('Invalid padding');
  return data.subarray(0, data.length - pad);
}

interface DhState {
  a: bigint;
  p: bigint;
}

async function generateY(): Promise<{ y: string; dhState: DhState }> {
  // Random 256-bit private key.
  const a = javaBytesToBigInt(crypto.getRandomValues(new Uint8Array(32)));
  const A = modPow(DH_G, a, DH_P);
  const aBytes = bigIntToJavaBytes(A);

  const iv = crypto.getRandomValues(new Uint8Array(16));
  // AES-128-CBC with zero padding — caller pre-pads PKCS7 to a 16x boundary.
  const padded = pkcs7Pad(aBytes, 16);
  const ck = await crypto.subtle.importKey('raw', Y_HEADER_KEY, { name: 'AES-CBC' }, false, ['encrypt']);
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, ck, padded);
  // crypto.subtle adds an extra 16B PKCS7 block when input is already aligned — drop it.
  const ct = new Uint8Array(ctBuf).subarray(0, padded.length);

  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv);
  combined.set(ct, iv.length);
  return { y: bytesToBase64(combined), dhState: { a, p: DH_P } };
}

async function decryptContent(
  cHeader: string,
  yHeaderServerB64: string,
  contentB64: string,
  dh: DhState,
): Promise<Uint8Array> {
  if (cHeader !== '1') return base64ToBytes(contentB64);

  const contentBytes = base64ToBytes(contentB64);
  const iv = contentBytes.subarray(0, 16);
  const ct = contentBytes.subarray(16);

  const B = javaBytesToBigInt(base64ToBytes(yHeaderServerB64));
  const s = modPow(B, dh.a, dh.p);

  // Take the LAST 32 bytes of s (after stripping leading zeros to mimic Java
  // BigInteger.toByteArray on a positive number).
  let sBytes = bigIntToJavaBytes(s);
  let i = stripLeadingZeros(sBytes);
  if (sBytes.length <= i + 31) i = sBytes.length - 32;
  if (i < 0) i = 0;
  const key = sBytes.subarray(i, i + 32);

  // AES-256-CBC with PKCS7 (PHP did ZERO_PADDING then manual unpad — net effect
  // is the same as PKCS7 decrypt as long as upstream encrypts with PKCS7).
  const ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, ct));
  // Web Crypto already strips PKCS7. PHP did unpad explicitly. Equivalent.
  return plain;
}

function processContent(s: string): string {
  const patterns: RegExp[] = [
    /<p class="pictureDesc" group-id="\d+" idx="\d+">/g,
    /<\/body>|<\/html>|<\/div>/g,
    /<p class="picture" group-id="\d+">/g,
    /<div data-fanqie-type="image" source="user">/g,
    /<head>.*<\/h1>/gs,
    /<!DOCTYPE.*<html>/gs,
    /<\?xml.*\?>/gs,
    /<p idx="\d+">/g,
    /<header>.*<\/header>/gs,
    /<article>|<\/article>/g,
    /<footer>|<\/footer>/g,
    /<tt_keyword.*keyword_ad>/g,
    /<p>/g,
  ];
  let out = s;
  for (const p of patterns) out = out.replace(p, '');
  out = out.replace(/&amp;x/g, '&x');
  out = out.replace(/<\/p>/g, '\n');
  return out;
}

export async function handleToutiao(req: Request, ctx: EndpointContext): Promise<Response> {
  const u = new URL(req.url);
  const itemIds = u.searchParams.get('item_ids');
  if (!itemIds) return badRequest('缺少item_ids参数');

  const url =
    `https://novel.snssdk.com/api/novel/book/reader/content/v1?aid=13&app_name=novelapp&channel=0` +
    `&device_platform=android&device_type=25053RT47C&item_id=${encodeURIComponent(itemIds)}` +
    `&os_version=10&support_image=1&version_code=66.9`;

  try {
    const qs = new URL(url).search.slice(1);
    const sig = await signRequest(qs, null, ctx.sigOpts);
    const { y, dhState } = await generateY();

    const res = await fetch(url, {
      headers: {
        'user-agent': 'com.ss.android.article.news/13400 (Linux; U; Android 10; zh_CN; tb8788p1_64_bsp; Build/QQ3A.200805.001; Cronet/TTNetVersion:fc4cebd3 2024-12-10 QuicVersion:d9628e3d 2024-10-11)',
        'accept-encoding': 'gzip, deflate',
        y,
        ...sig,
      },
    });
    if (!res.ok) return serverError(`upstream HTTP ${res.status}`);

    const cHeader = res.headers.get('c');
    const yHeaderServer = res.headers.get('y');
    const text = await res.text();
    let parsed: { data?: { content?: string } };
    try { parsed = JSON.parse(text); }
    catch (e) { return serverError(`JSON 解析失败: ${(e as Error).message}`); }

    const contentB64 = parsed.data?.content;
    if (!contentB64) return ok(parsed);

    if (cHeader && yHeaderServer) {
      try {
        const decrypted = await decryptContent(cHeader, yHeaderServer, contentB64, dhState);
        const cleaned = processContent(new TextDecoder().decode(decrypted));
        return ok({ content: cleaned });
      } catch (e) {
        console.warn('toutiao decrypt failed:', (e as Error).message);
      }
    }
    return ok(parsed);
  } catch (e) {
    return serverError((e as Error).message);
  }
}

// Internal helpers exposed only for unit tests.
export const _testing = {
  modPow,
  bigIntToJavaBytes,
  javaBytesToBigInt,
  decryptContent,
  generateY,
  DH_P,
  DH_G,
};