// MD5 (RFC 1321). Self-contained so unit tests run outside Workers
// (Workers' SubtleCrypto.digest also supports 'MD5' but Node does not).

const K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function rotl32(a: number, k: number): number {
  return ((a << k) | (a >>> (32 - k))) >>> 0;
}

export function md5(input: Uint8Array | string): Uint8Array {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const len = data.length;
  const padLen = (56 - (len + 1) % 64 + 64) % 64;
  const padded = new Uint8Array(len + 1 + padLen + 8);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setBigUint64(padded.length - 8, BigInt(len) * 8n, true);

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const M = new Uint32Array(16);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a, B = b, C = c, D = d;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16)       { f = (B & C) | (~B & D); g = i; }
      else if (i < 32)  { f = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48)  { f = B ^ C ^ D;          g = (3 * i + 5) % 16; }
      else              { f = C ^ (B | ~D);       g = (7 * i) % 16; }
      const temp = D;
      D = C;
      C = B;
      B = (B + rotl32(((A + (f >>> 0) + K[i]! + M[g]!) >>> 0), S[i]!)) >>> 0;
      A = temp;
    }
    a = (a + A) >>> 0;
    b = (b + B) >>> 0;
    c = (c + C) >>> 0;
    d = (d + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, a, true);
  outDv.setUint32(4, b, true);
  outDv.setUint32(8, c, true);
  outDv.setUint32(12, d, true);
  return out;
}

export function md5Hex(input: Uint8Array | string): string {
  const out = md5(input);
  let s = '';
  for (const x of out) s += x.toString(16).padStart(2, '0');
  return s;
}
