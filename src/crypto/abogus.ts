// ABogus — fanqienovel.com web-side signature.
// Mirrors final_php/ABogusManager.php (1072 lines).
//
// Pipeline:
//   1. randomPart = 12 random bytes (generateRandomStr — 3 iterations of
//      generateRandom with different option triples)
//   2. encryptedPart = generateRc4BbStr(query, ua, windowEnv) — assembles a
//      72-byte "data" array from timestamps + arg/env hashes + SM3 mixing,
//      then RC4-encrypts the assembled bbStr with key 'y'
//   3. result = customBase64(randomPart + encryptedPart, table='s4') + '='
//
// SM3 inside ABogus is byte-identical to standard SM3 — we reuse src/crypto/sm3.

import { sm3 } from '../crypto/sm3.js';

// Custom alphabets used by ABogus resultEncrypt (PHP `tables`).
const TABLES: Record<string, string> = {
  s0: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',
  s1: 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=',
  s2: 'Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=',
  s3: 'ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe',
  s4: 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe',
};

function rc4(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;

  // KSA
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    const t = s[i]!; s[i] = s[j]!; s[j] = t;
  }

  // PRGA
  const out = new Uint8Array(plaintext.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < plaintext.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    const t = s[i]!; s[i] = s[j]!; s[j] = t;
    const x = (s[i]! + s[j]!) & 0xff;
    out[k] = plaintext[k]! ^ s[x]!;
  }
  return out;
}

/** PHP `resultEncrypt(data, type)` — non-standard base64 with selectable alphabet. */
function customBase64(data: Uint8Array, type: keyof typeof TABLES = 's0'): string {
  const dict = TABLES[type] ?? TABLES.s0!;
  let result = '';
  for (let i = 0; i < data.length; i += 3) {
    const b0 = data[i]!;
    const b1 = i + 1 < data.length ? data[i + 1]! : 0;
    const b2 = i + 2 < data.length ? data[i + 2]! : 0;
    const combined = (b0 << 16) | (b1 << 8) | b2;
    for (let j = 0; j < 4; j++) {
      // PHP: if (i*8 + j*6 <= length*8) → use 6-bit index; else use index 64 (pad char)
      if (i * 8 + j * 6 <= data.length * 8) {
        const shift = 18 - j * 6;
        const idx = (combined >> shift) & 0x3f;
        result += dict[idx] ?? '';
      } else {
        result += dict[64] ?? '';
      }
    }
  }
  return result;
}

/** PHP `generateRandom(random, option)` — 4 bytes derived from random + option. */
function generateRandom(random: number, option: [number, number]): [number, number, number, number] {
  const lo = random & 0xff;
  const hi = (random >> 8) & 0xff;
  return [
    (lo & 0xaa) | (option[0] & 0x55),
    (lo & 0x55) | (option[0] & 0xaa),
    (hi & 0xaa) | (option[1] & 0x55),
    (hi & 0x55) | (option[1] & 0xaa),
  ];
}

/** PHP `generateRandomStr()` — 12-byte string (3 iterations × 4 bytes). */
function generateRandomStr(): Uint8Array {
  const out = new Uint8Array(12);
  for (let i = 0; i < 3; i++) {
    const r = Math.floor(Math.random() * 0x10000);
    const options: [number, number] = i === 0 ? [3, 45] : i === 1 ? [1, 0] : [1, 5];
    const bytes = generateRandom(r, options);
    out.set(bytes, i * 4);
  }
  return out;
}

// Helpers used in generateRc4BbStr.
const u8 = (v: number) => v & 0xff;

function divFloor(n: number, d: number): number {
  return Math.floor(n / d) & 0xff;
}

/** Core data assembly — 72-byte array + window env list + check byte → RC4-encrypted. */
function generateRc4BbStr(
  urlSearchParams: string,
  userAgent: string,
  windowEnvStr: string,
  suffix = 'cus',
  args: [number, number, number] = [0, 1, 14],
): Uint8Array {
  const startTime = Date.now();

  const urlHash = sm3(sm3(urlSearchParams + suffix));   // 32 bytes
  const cusHash = sm3(sm3(suffix));                      // 32 bytes

  // UA encryption key = single byte: int(0.00390625) → 0
  const uaKey = new Uint8Array([0]);
  const uaEncrypted = rc4(new TextEncoder().encode(userAgent), uaKey);
  const uaB64 = customBase64(uaEncrypted, 's3');
  const uaHash = sm3(uaB64);                              // 32 bytes

  const endTime = Date.now();

  // Sparse data array, indexed 8..72. Mirrors the exact slot writes from PHP.
  const data: Record<number, number> = {};
  data[8] = 3;
  data[10] = endTime;
  data[16] = startTime;
  data[18] = 44;
  data[20] = u8(startTime >>> 24);
  data[21] = u8(startTime >>> 16);
  data[22] = u8(startTime >>> 8);
  data[23] = u8(startTime);
  data[24] = u8(Math.floor(startTime / 0x100000000));
  data[25] = u8(Math.floor(startTime / 0x10000000000));
  data[26] = u8(args[0] >>> 24);
  data[27] = u8(args[0] >>> 16);
  data[28] = u8(args[0] >>> 8);
  data[29] = u8(args[0]);
  data[30] = divFloor(args[1], 256);
  data[31] = u8(args[1] % 256);
  data[32] = u8(args[1] >>> 24);
  data[33] = u8(args[1] >>> 16);
  data[34] = u8(args[2] >>> 24);
  data[35] = u8(args[2] >>> 16);
  data[36] = u8(args[2] >>> 8);
  data[37] = u8(args[2]);
  data[38] = urlHash[21]!;
  data[39] = urlHash[22]!;
  data[40] = cusHash[21]!;
  data[41] = cusHash[22]!;
  data[42] = uaHash[23]!;
  data[43] = uaHash[24]!;
  data[44] = u8(endTime >>> 24);
  data[45] = u8(endTime >>> 16);
  data[46] = u8(endTime >>> 8);
  data[47] = u8(endTime);
  data[48] = data[8]!;
  data[49] = u8(Math.floor(endTime / 0x100000000));
  data[50] = u8(Math.floor(endTime / 0x10000000000));
  data[51] = 6241;
  data[52] = u8(data[51] >>> 24);
  data[53] = u8(data[51] >>> 16);
  data[54] = u8(data[51] >>> 8);
  data[55] = u8(data[51]);
  data[56] = 6383;
  data[57] = u8(data[56]);
  data[58] = u8(data[56] >>> 8);
  data[59] = u8(data[56] >>> 16);
  data[60] = u8(data[56] >>> 24);

  const windowEnvList = Array.from(new TextEncoder().encode(windowEnvStr));
  data[64] = windowEnvList.length;
  data[65] = u8(data[64]);
  data[66] = u8(data[64] >>> 8);
  data[69] = 0;
  data[70] = u8(data[69]);
  data[71] = u8(data[69] >>> 8);

  // XOR check byte over a long list of slots.
  const checkSlots = [
    18, 20, 26, 30, 38, 40, 42, 21, 27, 31, 35, 39, 41, 43,
    22, 28, 32, 36, 23, 29, 33, 37, 44, 45, 46, 47, 48, 49, 50,
    24, 25, 52, 53, 54, 55, 57, 58, 59, 60, 65, 66, 70, 71,
  ];
  let check = 0;
  for (const s of checkSlots) check ^= data[s]!;
  data[72] = check & 0xff;

  // Final bb byte order — also from PHP, slot-by-slot.
  const bbSlots = [
    18, 20, 52, 26, 30, 34, 58, 38, 40, 53, 42, 21, 27, 54, 55,
    31, 35, 57, 39, 41, 43, 22, 28, 32, 60, 36, 23, 29, 33, 37,
    44, 45, 59, 46, 47, 48, 49, 50, 24, 25, 65, 66, 70, 71,
  ];
  const bb: number[] = [];
  for (const s of bbSlots) bb.push(data[s] ?? 0);
  // Append windowEnvList then check byte.
  for (const v of windowEnvList) bb.push(v);
  bb.push(data[72]!);

  const bbBytes = new Uint8Array(bb);
  return rc4(bbBytes, new TextEncoder().encode('y'));
}

export function generateABogus(urlSearchParams: string, userAgent: string): string {
  const randomPart = generateRandomStr();
  const encryptedPart = generateRc4BbStr(
    urlSearchParams,
    userAgent,
    '1536|747|1536|834|0|30|0|0|1536|834|1536|864|1525|747|24|24|Win32',
  );
  const combined = new Uint8Array(randomPart.length + encryptedPart.length);
  combined.set(randomPart);
  combined.set(encryptedPart, randomPart.length);
  return customBase64(combined, 's4') + '=';
}

// Re-exports for unit testing.
export const _testing = { rc4, customBase64, generateRandom, generateRc4BbStr };
