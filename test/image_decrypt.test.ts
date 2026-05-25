// Image decryption oracle test — AES-256-GCM with iv-prefix + tag-suffix layout.

import { describe, test, expect } from 'vitest';
import { decryptImage, detectImageFormat, parsePicInfos } from '../src/crypto/image_decrypt.js';

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substring(i * 2, i * 2 + 2), 16);
  return out;
}

describe('decryptImage (vs PHP openssl_decrypt AES-256-GCM)', () => {
  test('round-trip from PHP-encrypted PNG header', async () => {
    const key = hexToBytes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const blob = hexToBytes('aabbccddeeff0011223344555227ccd84ece23332af7931eb8774ce4671c664bd34a0f5f');
    const plain = await decryptImage(blob, key);
    expect(plain).not.toBeNull();
    expect(hex(plain!)).toBe('89504e470d0a1a0a');
  });

  test('returns null on wrong key (tag mismatch)', async () => {
    const wrongKey = new Uint8Array(32);
    const blob = hexToBytes('aabbccddeeff0011223344555227ccd84ece23332af7931eb8774ce4671c664bd34a0f5f');
    expect(await decryptImage(blob, wrongKey)).toBeNull();
  });

  test('returns null on too-short input', async () => {
    expect(await decryptImage(new Uint8Array(20), new Uint8Array(32))).toBeNull();
  });
});

describe('detectImageFormat (magic-byte sniff)', () => {
  test('PNG', () => {
    expect(detectImageFormat(hexToBytes('89504e470d0a1a0a'))).toBe('png');
  });
  test('JPG', () => {
    expect(detectImageFormat(hexToBytes('ffd8ffe000104a464946'))).toBe('jpg');
  });
  test('GIF', () => {
    expect(detectImageFormat(hexToBytes('474946383961'))).toBe('gif');
  });
  test('WebP', () => {
    expect(detectImageFormat(hexToBytes('52494646000000005745425056503820'))).toBe('webp');
  });
  test('Unknown → defaults to png', () => {
    expect(detectImageFormat(hexToBytes('00000000'))).toBe('png');
  });
});

describe('parsePicInfos', () => {
  test('happy path', () => {
    const json = JSON.stringify({
      encrypt_key: 'abc'.repeat(21).substring(0, 64),
      picInfos: [{ picUrl: 'https://example.com/a.bin' }, { picUrl: 'https://example.com/b.bin' }],
    });
    const r = parsePicInfos(json);
    expect(r?.picInfos.length).toBe(2);
  });

  test('null on missing encrypt_key', () => {
    expect(parsePicInfos(JSON.stringify({ picInfos: [] }))).toBeNull();
  });

  test('null on bad JSON', () => {
    expect(parsePicInfos('not json')).toBeNull();
  });
});
