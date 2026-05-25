// Oracle tests for device registration's tt-flavored crypto.
// Vectors captured from PHP DevicePoolManager in /tmp/tt_oracle.php.

import { describe, test, expect } from 'vitest';
import {
  deriveTtKdf,
  ttEncrypt,
  androidDecryptKey,
  registerKeyEncryptDeviceId,
  getHashKey,
} from '../src/device/tt_crypto.js';
import { androidReverseHex, randomUuidLower } from '../src/device/util.js';

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

// random_bytes used in the PHP oracle script
const RND32 = (() => {
  const b = new Uint8Array(32);
  for (let i = 0; i < 16; i++) { b[i] = i * 0x11; b[i + 16] = i * 0x11; }
  return b;
})();

describe('ttEncrypt KDF (vs PHP oracle)', () => {
  test('aesKey + aesIv from fixed 32B random', async () => {
    const { key, iv } = await deriveTtKdf(RND32);
    expect(hex(key)).toBe('acb24f4ab941f322e33255a5a5e95cc0');
    expect(hex(iv)).toBe('1a4f0703b3fd69b25b869d68c97a5706');
  });
});

describe('androidReverseHex (vs PHP oracle)', () => {
  test('deviceId 7234567890123456', () => {
    expect(androidReverseHex('7234567890123456')).toBe('c0ba3119cdb319000000000000000000');
  });

  test('handles BigInt-range deviceIds', () => {
    // 19-digit id that overflows JS Number — must survive via BigInt
    const big = '9223372036854775000';
    const result = androidReverseHex(big);
    expect(result).toHaveLength(32);
    // round-trip: read pairs back, reverse, parse
    let rebuilt = '';
    for (let i = result.length; i > 0; i -= 2) rebuilt += result.substring(i - 2, i);
    expect(BigInt('0x' + rebuilt).toString()).toBe(big);
  });
});

describe('androidDecryptKey (vs PHP oracle)', () => {
  test('decrypt fixture produced by PHP openssl_encrypt', async () => {
    const ciphertext = 'ERERESIiIiIzMzMzREREROUzGNPOT2YCpgtHSL4gf6Bxvm2OOrn8vUTZTnPAip3k';
    const out = await androidDecryptKey(ciphertext);
    expect(out).not.toBeNull();
    expect(hex(out!)).toBe('aabbccddeeff00112233445566778899');
  });

  test('rejects too-short input', async () => {
    expect(await androidDecryptKey('AAAA')).toBeNull();
  });
});

describe('registerKeyEncryptDeviceId (vs PHP oracle)', () => {
  test('matches openssl AES-128-CBC PKCS7', async () => {
    const enc = await registerKeyEncryptDeviceId(
      '00112233445566778899aabbccddeeff',
      '0123456789abcdef',
    );
    expect(hex(enc)).toBe('87eda73c8727808e8c902d31b89563c290a530782863e231e94c181759fc2e5b');
  });
});

describe('ttEncrypt full envelope (round-trip, gzip-implementation-independent)', () => {
  test('decryptable with the same KDF', async () => {
    const data = new TextEncoder().encode('{"header":{"device_model":"ABCDE12","openudid":"abcdef0123456789abcdef0123456789abcdef01","package":"com.dragon.read"}}');
    const enc = await ttEncrypt(data, RND32);

    // Layout: 6B magic || 32B random || ciphertext
    expect(enc.slice(0, 6)).toEqual(new Uint8Array([0x74, 0x63, 0x05, 0x10, 0x00, 0x00]));
    expect(enc.slice(6, 38)).toEqual(RND32);

    const { key, iv } = await deriveTtKdf(RND32);
    const ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, enc.subarray(38)),
    );

    // First 64 bytes = SHA-512(compressed); rest = compressed bytes
    expect(plain.length).toBeGreaterThan(64);
    const sha = plain.subarray(0, 64);
    const compressed = plain.subarray(64);
    const actualSha = new Uint8Array(await crypto.subtle.digest('SHA-512', compressed));
    expect(hex(sha)).toBe(hex(actualSha));

    // gunzip → original data
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    void w.write(compressed);
    void w.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const recovered = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of chunks) { recovered.set(c, off); off += c.length; }
    expect(new TextDecoder().decode(recovered)).toBe(new TextDecoder().decode(data));
  });
});

describe('util sanity', () => {
  test('getHashKey is 64 bytes', () => {
    expect(getHashKey().length).toBe(64);
  });

  test('randomUuidLower has v4 shape', () => {
    const id = randomUuidLower();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
