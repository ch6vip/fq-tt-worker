// spade URL decryption oracle test — PHP-generated vector.

import { describe, test, expect } from 'vitest';
import { decryptSpadeUrl } from '../src/crypto/spade.js';

function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substring(i * 2, i * 2 + 2), 16);
  return out;
}

describe('decryptSpadeUrl (vs PHP openssl_decrypt path)', () => {
  test('round-trip from PHP-encrypted URL', async () => {
    const keySeed = hexToBytes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const encrypted = 'qAABABL5hdVXQUfUHKUy84VYV4e1aYQF8PSpbqO8rAizgYycMcxB8OwR4tqrt8j0hMLDOQ';
    const decrypted = await decryptSpadeUrl(encrypted, keySeed);
    expect(decrypted).toBe('https://example.com/video.m3u8?token=xyz');
  });

  test('empty input → empty string', async () => {
    expect(await decryptSpadeUrl('', new Uint8Array(32))).toBe('');
  });

  test('bad header → throws', async () => {
    const keySeed = new Uint8Array(32);
    // 4-byte header that doesn't start with 0xA8
    await expect(decryptSpadeUrl('AAAAAAECAwQFBgcICQ==', keySeed)).rejects.toThrow();
  });
});
