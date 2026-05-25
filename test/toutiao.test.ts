// Toutiao DH-handshake oracle test.

import { describe, test, expect } from 'vitest';
import { _testing } from '../src/endpoints/toutiao.js';

const { modPow, bigIntToJavaBytes, javaBytesToBigInt, decryptContent, DH_P, DH_G } = _testing;

describe('Toutiao modPow + bigIntToJavaBytes (BigInt sanity)', () => {
  test('modPow base cases', () => {
    expect(modPow(2n, 10n, 1000n)).toBe(24n);                // 2^10 % 1000 = 24
    expect(modPow(3n, 5n, 7n)).toBe(5n);                     // 3^5 % 7 = 5
    expect(modPow(DH_G, 1n, DH_P)).toBe(2n);                 // g^1 mod p = g
  });

  test('bigIntToJavaBytes prepends 0x00 when high bit is set (Java BigInteger semantics)', () => {
    // 0xFF has high bit set → output should be [0x00, 0xFF]
    const r = bigIntToJavaBytes(0xffn);
    expect(Array.from(r)).toEqual([0x00, 0xff]);
  });

  test('bigIntToJavaBytes does NOT prepend when high bit is clear', () => {
    const r = bigIntToJavaBytes(0x7fn);
    expect(Array.from(r)).toEqual([0x7f]);
  });

  test('javaBytesToBigInt is round-trip safe', () => {
    const cases = [0n, 1n, 0x7fn, 0xffn, 0x100n, 0xdeadbeefn, (1n << 200n)];
    for (const v of cases) {
      const bytes = bigIntToJavaBytes(v);
      // Round-trip skips any leading sign byte
      const restored = javaBytesToBigInt(bytes[0] === 0 && bytes.length > 1 ? bytes.subarray(1) : bytes);
      expect(restored).toBe(v);
    }
  });
});

describe('Toutiao decryptContent (vs PHP oracle, fixed client key)', () => {
  test('decrypts a server-encrypted payload', async () => {
    const a = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
    const serverKey = 'ALecrQfYYr5dYUFIytlAV64tA1UNzp2rk6ME/atyw3pLMZq+XiQyl9YxyvgP7RLbsUVMHBOERErLeb8pqfnf5atvM6tVYN33bTZhHw76cYW0fupisq8EJ2b9rJ5gKN2nDyfPheOyrC8++pPridXSi4PK58guNoMpsXB6+2O9k7fevDvssGeRQGOsQNWNAVsALphBdReKiSiDnpRSQMQHKhqoM1F6L83+2Y0xQEQ9nvTizpsDgkGhPNxtgLRapH9KbA==';
    const content = 'qrvM3e7/ABEiM0RVZneImVBZiVx17ubsTC95rKPocDZ9n8EA1/a1MxnBZcsqWbJInAEFI/32A9OTz48qJFVMww==';

    const plain = await decryptContent('1', serverKey, content, { a, p: DH_P });
    // Strip PKCS7 padding bytes
    const decoded = new TextDecoder().decode(plain).replace(/[\x01-\x10]+$/, '');
    expect(decoded).toBe('fixed test content for toutiao DH decrypt path');
  });
});
