// Ladon signature.
// Mirrors final_php/Ladon.php — 34-round hash_table evolution + per-block mix.

import { md5Hex } from './md5.js';

const MASK64 = 0xffffffffffffffffn;

function readU64LE(b: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v |= BigInt(b[off + i]!) << BigInt(i * 8);
  return v;
}

function writeU64LE(b: Uint8Array, off: number, v: bigint): void {
  for (let i = 0; i < 8; i++) b[off + i] = Number((v >> BigInt(i * 8)) & 0xffn);
}

function rotr64(v: bigint, n: number): bigint {
  const nb = BigInt(n);
  return ((v >> nb) | ((v << BigInt(64 - n)) & MASK64)) & MASK64;
}

function buildHashTable(md5hex: string): Uint8Array {
  const ht = new Uint8Array(288);
  const lim = Math.min(32, md5hex.length);
  for (let i = 0; i < lim; i++) ht[i] = md5hex.charCodeAt(i) & 0xff;

  // initial 4 u64s from ht[0..32]
  const u: bigint[] = [];
  for (let i = 0; i < 4; i++) u.push(readU64LE(ht, i * 8));

  let bufferB0 = u[0]!;
  let bufferB8 = u[1]!;
  const temp: bigint[] = [u[2]!, u[3]!];

  for (let i = 0; i < 34; i++) {
    const x9 = bufferB0;
    let x8 = bufferB8;
    x8 = rotr64(x8, 8);
    x8 = (x8 + x9) & MASK64;
    x8 = x8 ^ BigInt(i);
    temp.push(x8);
    const rorX9 = rotr64(x9, 61);
    x8 = x8 ^ rorX9;
    writeU64LE(ht, (i + 1) * 8, x8);
    bufferB0 = x8;
    bufferB8 = temp.shift()!;
  }
  return ht;
}

function ladonInput(hashTable: Uint8Array, block: Uint8Array): Uint8Array {
  let data0 = readU64LE(block, 0);
  let data1 = readU64LE(block, 8);

  for (let i = 0; i < 34; i++) {
    const hash = readU64LE(hashTable, i * 8);
    const rot = rotr64(data1, 8);
    const sum = (data0 + rot) & MASK64;
    data1 = (hash ^ sum) & MASK64;
    const r2 = rotr64(data0, 61);
    data0 = (data1 ^ r2) & MASK64;
  }

  const out = new Uint8Array(16);
  writeU64LE(out, 0, data0);
  writeU64LE(out, 8, data1);
  return out;
}

function encryptLadon(md5hex: string, data: Uint8Array): Uint8Array {
  const ht = buildHashTable(md5hex);
  const padLen = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded.fill(padLen, data.length);

  const out = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16) {
    const enc = ladonInput(ht, padded.subarray(i, i + 16));
    out.set(enc, i);
  }
  return out;
}

function bytesToBase64(b: Uint8Array): string {
  return btoa(String.fromCharCode.apply(null, b as unknown as number[]));
}

/**
 * Generate X-Ladon header.
 *
 * @param khronos    unix seconds (string or number)
 * @param licenseId  default 1611921764
 * @param aid        default 1967
 * @param randomBytes optional 4 bytes; if omitted, crypto.getRandomValues is used
 */
export function ladonEncrypt(
  khronos: number | string,
  licenseId = 1611921764,
  aid = 1967,
  randomBytes?: Uint8Array,
): string {
  const rnd = randomBytes ?? crypto.getRandomValues(new Uint8Array(4));
  if (rnd.length !== 4) throw new Error('randomBytes must be 4 bytes');

  const data = new TextEncoder().encode(`${khronos}-${licenseId}-${aid}`);
  // keygen = randomBytes (binary) ++ ascii(aid)
  const aidStr = new TextEncoder().encode(String(aid));
  const keygen = new Uint8Array(rnd.length + aidStr.length);
  keygen.set(rnd);
  keygen.set(aidStr, rnd.length);

  const encrypted = encryptLadon(md5Hex(keygen), data);
  const output = new Uint8Array(rnd.length + encrypted.length);
  output.set(rnd);
  output.set(encrypted, rnd.length);

  return bytesToBase64(output);
}
