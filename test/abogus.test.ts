// ABogus oracle tests.
//
// Note on PHP parity: final_php/ABogusManager.php has a decompiler bug —
// `$tables` is indexed by integers 0-4 but methods call `resultEncrypt(data, 's4')`
// with string keys, so the lookup silently fails and PHP returns ''. Our TS port
// fixes that to match the *intended* behavior (string keys → corresponding
// alphabet). The oracle script in /tmp/abogus_oracle2.php confirms the alphabets
// themselves are byte-identical to what we have.

import { describe, test, expect } from 'vitest';
import { generateABogus, _testing } from '../src/crypto/abogus.js';

const { rc4, customBase64, generateRandom } = _testing;

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

describe('ABogus RC4 (vs PHP oracle)', () => {
  test('key="Key" plain="Plaintext"', () => {
    const ct = rc4(new TextEncoder().encode('Plaintext'), new TextEncoder().encode('Key'));
    expect(hex(ct)).toBe('bbf316e8d940af0ad3');
  });

  test('key="y" plain="hello world"', () => {
    const ct = rc4(new TextEncoder().encode('hello world'), new TextEncoder().encode('y'));
    expect(hex(ct)).toBe('2de1c82eebc73e5a9bccce');
  });
});

describe('ABogus customBase64 (vs PHP oracle / intended behavior)', () => {
  test('s0 alphabet matches standard base64', () => {
    expect(customBase64(new TextEncoder().encode('abc'), 's0')).toBe('YWJj');
  });

  // PHP returned 'RIsN' for type=1/2/3/4 on 'abc' because positions 9/22/24/35
  // happen to be identical across all the custom alphabets.
  test('s1 alphabet → RIsN for abc', () => {
    expect(customBase64(new TextEncoder().encode('abc'), 's1')).toBe('RIsN');
  });

  test('s4 alphabet → RIsN for abc', () => {
    expect(customBase64(new TextEncoder().encode('abc'), 's4')).toBe('RIsN');
  });
});

describe('ABogus generateRandom (vs PHP oracle)', () => {
  test('random=0x1234 options=[3,45]', () => {
    expect(generateRandom(0x1234, [3, 45])).toEqual([33, 22, 7, 56]);
  });

  test('random=0xABCD options=[1,5]', () => {
    expect(generateRandom(0xabcd, [1, 5])).toEqual([137, 69, 175, 1]);
  });
});

describe('ABogus generateABogus (smoke)', () => {
  test('produces a non-empty string with correct shape', () => {
    const result = generateABogus('aid=1967&device_id=abc', 'Mozilla/5.0 Chrome/120');
    expect(result.endsWith('=')).toBe(true);
    expect(result.length).toBeGreaterThan(100);
  });
});
