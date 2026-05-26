// Manga image decryption helper — corresponds to final_php/DomainImageDecryptor.php.
//
// Algorithm: AES-256-GCM with iv=12B prefix + tag=16B suffix on each image.
// Layout of encryptedData: [iv:12 | ciphertext:N | tag:16].
//
// PHP DomainImageDecryptor.php (506 lines) does much more — Diffie-Hellman key
// init (unused in actual decrypt!), parallel cURL downloads via curl_multi_init,
// disk caching to /src/, format sniffing, filename munging, etc.
//
// Worker port keeps only the decrypt step. Hosting/caching is the consumer's
// job; CompressionStream/file_put_contents have no Worker equivalent anyway.

import type { EndpointContext } from '../endpoints/base.js';
import { fetchWithTimeout } from '../http.js';

export interface PicInfo {
  picUrl?: string;
  [key: string]: unknown;
}

/** Decrypt a single image's AES-256-GCM blob. Returns null on failure. */
export async function decryptImage(encryptedData: Uint8Array, keyBytes: Uint8Array): Promise<Uint8Array | null> {
  if (encryptedData.length < 28) return null;
  if (keyBytes.length !== 32) return null;
  const iv = encryptedData.subarray(0, 12);
  // Web Crypto's AES-GCM expects ciphertext concatenated with tag at the end —
  // PHP keeps them separate, but `encryptedData.subarray(12)` is exactly that
  // concatenation (ciphertext..tag) so we can pass it through directly.
  const ctWithTag = encryptedData.subarray(12);
  try {
    const ck = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, ck, ctWithTag);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Sniff image format from leading bytes. Mirrors PHP getOriginalFormat. */
export function detectImageFormat(data: Uint8Array): 'jpg' | 'png' | 'gif' | 'webp' {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'gif';
  if (
    data.length >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) return 'webp';
  return 'png';
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToBase64(b: Uint8Array): string {
  return btoa(String.fromCharCode.apply(null, b as unknown as number[]));
}

/**
 * Server-side download + decrypt all images. Returns array of base64 strings.
 *
 * Watch out on Workers: each image is one subrequest (limit 50/req paid plan).
 * For large manga (>50 pages) consider client-side decryption instead — call
 * with `decode=false` from the endpoint and let the client do the AES-GCM.
 */
export async function downloadAndDecryptImages(
  picInfos: PicInfo[],
  encryptKeyHex: string,
): Promise<Array<{ url: string; format: string; data_b64?: string; error?: string }>> {
  const key = hexToBytes(encryptKeyHex);
  if (key.length !== 32) throw new Error('encrypt_key must be 32 bytes (64 hex chars)');

  // Parallel fetch — Promise.all keeps the request fanout but respects the
  // total Worker subrequest budget.
  return await Promise.all(
    picInfos.map(async (pic) => {
      const url = pic.picUrl ?? '';
      if (!url) return { url, format: 'unknown', error: 'missing picUrl' };
      try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) return { url, format: 'unknown', error: `HTTP ${res.status}` };
        const enc = new Uint8Array(await res.arrayBuffer());
        const dec = await decryptImage(enc, key);
        if (!dec) return { url, format: 'unknown', error: 'decrypt failed' };
        return { url, format: detectImageFormat(dec), data_b64: bytesToBase64(dec) };
      } catch (e) {
        return { url, format: 'unknown', error: (e as Error).message };
      }
    }),
  );
}

/** Parse picInfos JSON. Mirrors the PHP `parseMangaImages` JSON extraction. */
export function parsePicInfos(rawJson: string): { encryptKey: string; picInfos: PicInfo[] } | null {
  try {
    const data = JSON.parse(rawJson) as { picInfos?: PicInfo[]; encrypt_key?: string };
    if (!data.picInfos || !data.encrypt_key) return null;
    return { encryptKey: data.encrypt_key, picInfos: data.picInfos };
  } catch {
    return null;
  }
}

// Suppress unused warning until manga.ts wires this in
export type _DomainImageDecryptorCtx = EndpointContext;
