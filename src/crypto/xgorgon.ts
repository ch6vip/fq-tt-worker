// X-Gorgon 0404 / 8404.
// Mirrors final_php/config/0404.php and final_php/config/8404.php.

import { md5, md5Hex } from './md5.js';

const KEY_0404 = [
  223, 119, 185, 64, 185, 155, 132, 131, 209, 185, 203, 209,
  247, 194, 185, 133, 195, 208, 251, 195,
];

function reverseBits8(b: number): number {
  let r = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 1 << (7 - i);
  return r;
}

function toHex(bytes: Iterable<number>): string {
  let s = '';
  for (const b of bytes) s += (b & 0xff).toString(16).padStart(2, '0');
  return s;
}

export interface GorgonResult {
  x_gorgon: string;
  timestamp: number;
}

/** 0404 — deterministic given (param, unix, cookies). */
export function gorgon0404(param: string, unix: number, cookies?: string | null): GorgonResult {
  const xSsStub = '0'.repeat(32);
  const base = md5Hex(param ?? '') + xSsStub + (cookies ? md5Hex(cookies) : '0'.repeat(32));

  const list: number[] = [];
  for (const start of [0, 32, 64]) {
    const temp = base.substring(start, start + 8);
    for (let j = 0; j < 4; j++) list.push(parseInt(temp.substring(j * 2, j * 2 + 2), 16));
  }
  list.push(0, 6, 11, 28);
  list.push((unix >>> 24) & 0xff, (unix >>> 16) & 0xff, (unix >>> 8) & 0xff, unix & 0xff);

  const len = 20;
  const eor = new Array<number>(len);
  for (let i = 0; i < len; i++) eor[i] = list[i]! ^ KEY_0404[i]!;

  for (let i = 0; i < len; i++) {
    const byte = eor[i]!;
    const swapped = ((byte & 0x0f) << 4) | ((byte & 0xf0) >> 4);
    const e = swapped ^ eor[(i + 1) % len]!;
    const f = reverseBits8(e);
    eor[i] = ((~f & 0xff) ^ len) & 0xff;
  }

  return { x_gorgon: '0404b0d30000' + toHex(eor), timestamp: unix };
}

/** 8404 — deterministic given (param, unix, rand). `rand` is 2 random bytes. */
export function gorgon8404(param: string, unix: number, rand: Uint8Array): GorgonResult {
  if (rand.length !== 2) throw new Error('rand must be 2 bytes');
  const rb1 = rand[0]!, rb2 = rand[1]!;

  // data = md5(param)[:4] || 4x \x00 || [0,0,0,0,0,1,7,4] || time(BE u32)  -> 20 bytes
  const data = new Uint8Array(20);
  data.set(md5(param ?? '').subarray(0, 4), 0);
  data.set([0, 0, 0, 0, 0, 1, 7, 4], 8);
  new DataView(data.buffer).setUint32(16, unix >>> 0, false);
  const dataLen = data.length;

  // KSA-like
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = i;
  const key = [74, 0, 22, rb2, 71, 108, 0, rb1];
  let w8 = 0;
  for (let i = 0; i < 256; i++) {
    const w9 = (w8 + table[i]! + key[i & 7]!) >>> 0;
    const w20 = w9 & 0xff;
    table[i] = table[w20]!;
    w8 = w20;
  }

  // PRGA-like (PHP loops i from 1..dataLen — we use 0..dataLen-1)
  let w26 = 0;
  for (let i = 0; i < dataLen; i++) {
    const w25 = i;                       // PHP i-1
    const w8_ = w25 ^ 1;
    const w9_ = ((w25 & 1) << 1) & 2;
    const x10 = (w9_ + w8_) & 0xff;

    const w9b = table[x10]!;
    const w11 = (w26 ^ w9b) >>> 0;
    const w9c = ((w26 | w9b) << 1) >>> 0;
    w26 = (w9c - w11) >>> 0;
    const x11 = w26 & 0xff;

    const w12 = table[x11]!;
    table[x10] = w12;
    table[x11] = w12;                    // PHP overwrites both with w12 (not a swap)

    const ks = table[(2 * w12) & 0xff]!;
    data[i] = ks ^ data[i]!;
  }

  // Second pass: nibble swap + adjacent-XOR + bit mixing
  const W2 = 0xffffffaa | 0;             // -86 as i32
  const W3 = 85;
  const W4 = 51;
  const W8_2 = ~dataLen;                 // i32; only its low bits matter (xor + &0xff)

  for (let i = 0; i < dataLen; i++) {
    const val = data[i]!;
    let w16 = ((val >> 4) & 0x0f) | ((val & 0x0f) << 4);
    data[i] = w16 & 0xff;

    if (i === dataLen - 1) {
      data[i] = (w16 ^ data[0]!) & 0xff;
    } else {
      const w7 = data[i]!;
      const w16n = data[i + 1]!;
      data[i] = ((w7 | w16n) - (w7 & w16n)) & 0xff;  // == w7 ^ w16n
    }

    let w13 = data[i]!;
    const t1 = W2 & (w13 << 1);
    const t2 = W3 & (w13 >> 1);
    w13 = t1 | t2;

    const t3 = w13 << 2;
    const t4 = W4 & (w13 >> 2);
    let mix = t4 | (t3 & 0xffffffcf);

    const high = (mix >> 4) & 0x0f;
    const low = mix & 0x0fffffff;
    mix = high | (low << 4);

    data[i] = (mix ^ W8_2) & 0xff;
  }

  const out = new Uint8Array(6 + dataLen);
  out.set([0x84, 0x04, rb1, rb2, 0x00, 0x00], 0);
  out.set(data, 6);
  return { x_gorgon: toHex(out), timestamp: unix };
}

/** Dispatch by algorithm name. */
export function gorgon(
  algorithm: '0404' | '8404',
  param: string,
  unix: number,
  opts?: { cookies?: string | null; rand?: Uint8Array },
): GorgonResult {
  if (algorithm === '0404') return gorgon0404(param, unix, opts?.cookies);
  const rand = opts?.rand ?? crypto.getRandomValues(new Uint8Array(2));
  return gorgon8404(param, unix, rand);
}
