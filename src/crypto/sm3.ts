// SM3 国密哈希 (GB/T 32905-2016).
// Mirrors final_php/SM3.php — same IV, TJ, FF_j, GG_j, P_0, P_1 layout.

const IV = new Uint32Array([
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
  0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
]);

const TJ = new Uint32Array(64);
for (let j = 0; j < 16; j++) TJ[j] = 0x79cc4519;
for (let j = 16; j < 64; j++) TJ[j] = 0x7a879d8a;

function rotl32(a: number, k: number): number {
  k &= 31;
  if (k === 0) return a >>> 0;
  return ((a << k) | (a >>> (32 - k))) >>> 0;
}

function ff(x: number, y: number, z: number, j: number): number {
  return (j < 16 ? x ^ y ^ z : (x & y) | (x & z) | (y & z)) >>> 0;
}

function gg(x: number, y: number, z: number, j: number): number {
  return (j < 16 ? x ^ y ^ z : (x & y) | (~x & z)) >>> 0;
}

const p0 = (x: number) => (x ^ rotl32(x, 9) ^ rotl32(x, 17)) >>> 0;
const p1 = (x: number) => (x ^ rotl32(x, 15) ^ rotl32(x, 23)) >>> 0;

function compress(v: Uint32Array, block: Uint8Array): void {
  const w = new Uint32Array(68);
  const w1 = new Uint32Array(64);
  const dv = new DataView(block.buffer, block.byteOffset, 64);
  for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4, false);
  for (let j = 16; j < 68; j++) {
    w[j] = (p1((w[j - 16]! ^ w[j - 9]! ^ rotl32(w[j - 3]!, 15)) >>> 0)
          ^ rotl32(w[j - 13]!, 7) ^ w[j - 6]!) >>> 0;
  }
  for (let j = 0; j < 64; j++) w1[j] = (w[j]! ^ w[j + 4]!) >>> 0;

  let a = v[0]!, b = v[1]!, c = v[2]!, d = v[3]!;
  let e = v[4]!, f = v[5]!, g = v[6]!, h = v[7]!;

  for (let j = 0; j < 64; j++) {
    const ss1 = rotl32(((rotl32(a, 12) + e + rotl32(TJ[j]!, j)) >>> 0), 7);
    const ss2 = (ss1 ^ rotl32(a, 12)) >>> 0;
    const tt1 = (ff(a, b, c, j) + d + ss2 + w1[j]!) >>> 0;
    const tt2 = (gg(e, f, g, j) + h + ss1 + w[j]!) >>> 0;
    d = c;
    c = rotl32(b, 9);
    b = a;
    a = tt1;
    h = g;
    g = rotl32(f, 19);
    f = e;
    e = p0(tt2);
  }

  v[0] = (v[0]! ^ a) >>> 0;
  v[1] = (v[1]! ^ b) >>> 0;
  v[2] = (v[2]! ^ c) >>> 0;
  v[3] = (v[3]! ^ d) >>> 0;
  v[4] = (v[4]! ^ e) >>> 0;
  v[5] = (v[5]! ^ f) >>> 0;
  v[6] = (v[6]! ^ g) >>> 0;
  v[7] = (v[7]! ^ h) >>> 0;
}

export function sm3(input: Uint8Array | string): Uint8Array {
  const msg = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const len = msg.length;
  const bitLen = BigInt(len) * 8n;

  // pad: 0x80 then 0x00s, then 8-byte big-endian bit length
  const padLen = (56 - (len + 1) % 64 + 64) % 64;
  const padded = new Uint8Array(len + 1 + padLen + 8);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setBigUint64(padded.length - 8, bitLen, false);

  const v = new Uint32Array(IV);
  for (let off = 0; off < padded.length; off += 64) {
    compress(v, padded.subarray(off, off + 64));
  }

  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outDv.setUint32(i * 4, v[i]!, false);
  return out;
}
