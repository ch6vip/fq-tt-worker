// Argus signature.
// Mirrors final_php/Argus.php — same constants, same Simon-then-AES chain,
// same 17B prefix/suffix patch, same `ao` literal, same 2B cipher header.
//
// Pipeline:
//   protobuf(xargusBean)
//     → PKCS7 pad to 16x
//     → per-block Simon128/256 encrypt (key from signKey hex)
//     → wrap with 8B prefix + 9B suffix  (decompiler missed these)
//     → encryptEncPb (XOR-with-head + reverse)
//     → append literal 'ao'
//     → PKCS7 pad to 16x
//     → AES-128-CBC encrypt, no padding
//     → prepend 2B header 0xF2 0x81
//     → base64

import { sm3 } from './sm3.js';
import { simonEnc } from './simon.js';
import { encodeProto, type ProtoValue } from './protobuf.js';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function pkcs7Pad(data: Uint8Array, block = 16): Uint8Array {
  const padLen = block - (data.length % block);
  const out = new Uint8Array(data.length + padLen);
  out.set(data);
  out.fill(padLen, data.length);
  return out;
}

// PHP encryptEncPb: XOR bytes 8.. with rolling 8-byte head, then reverse.
function encryptEncPb(data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(data);
  for (let i = 8; i < buf.length; i++) {
    buf[i] = (buf[i]! ^ buf[i % 8]!) & 0xff;
  }
  return buf.reverse();
}

// Read 8 LE bytes as u64.
function readU64LE(b: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v |= BigInt(b[off + i]!) << BigInt(i * 8);
  return v;
}

// Write u64 as 8 LE bytes into b[off..off+8].
function writeU64LE(b: Uint8Array, off: number, v: bigint): void {
  for (let i = 0; i < 8; i++) {
    b[off + i] = Number((v >> BigInt(i * 8)) & 0xffn);
  }
}

// AES-128-CBC, no padding. Web Crypto forces PKCS7, so feed it 16x-aligned
// plaintext then drop the trailing 16-byte padding block.
async function aesCbcNoPad(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  if (plaintext.length % 16 !== 0) throw new Error('plaintext must be 16-aligned');
  const ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  const buf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, ck, plaintext);
  return new Uint8Array(buf).subarray(0, plaintext.length);
}

export interface ArgusConstants {
  /** 32-byte Simon key (hex was: fc78e0a9...5304). */
  signKey: Uint8Array;
  /** 16-byte AES-128-CBC key. */
  aesKey: Uint8Array;
  /** 16-byte AES-128-CBC IV. */
  aesIv: Uint8Array;
  /** 8-byte prefix sandwiched in front of Simon output. */
  encPbPrefix: Uint8Array;
  /** 9-byte suffix appended after Simon output. */
  encPbSuffix: Uint8Array;
  /** Literal 'ao' appended after encryptEncPb. */
  aoSuffix: Uint8Array;
  /** 2-byte header prepended to AES ciphertext before base64. */
  cipherPrefix: Uint8Array;
}

export const DEFAULT_ARGUS_CONSTANTS: ArgusConstants = {
  signKey:    hexToBytes('fc78e0a9657a0c748ce51559903ccf03510e51d3cff232d71343e88a321c5304'),
  aesKey:     hexToBytes('d31e3718288a1027baab59f146a09a9c'),
  aesIv:      hexToBytes('ea180a0336ed352fcd24e4d50018ae54'),
  encPbPrefix: hexToBytes('f2f7fcfff2f7fcff'),
  encPbSuffix: hexToBytes('eafb2cfe8568519154'),
  aoSuffix:   new TextEncoder().encode('ao'),
  cipherPrefix: hexToBytes('f281'),
};

export async function encryptArgus(
  xargusBean: { [key: number]: ProtoValue },
  k: ArgusConstants = DEFAULT_ARGUS_CONSTANTS,
): Promise<string> {
  // 1) protobuf + PKCS7 pad
  const padded = pkcs7Pad(encodeProto(xargusBean), 16);

  // 2) split signKey into 4 × u64 (LE) → Simon key words
  const keyWords: [bigint, bigint, bigint, bigint] = [
    readU64LE(k.signKey, 0),
    readU64LE(k.signKey, 8),
    readU64LE(k.signKey, 16),
    readU64LE(k.signKey, 24),
  ];

  // 3) per-16B-block Simon encrypt
  const encPb = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16) {
    const pt: [bigint, bigint] = [readU64LE(padded, i), readU64LE(padded, i + 8)];
    const [c0, c1] = simonEnc(pt, keyWords);
    writeU64LE(encPb, i, c0);
    writeU64LE(encPb, i + 8, c1);
  }

  // 4) wrap with 8B prefix + 9B suffix → encryptEncPb → append 'ao'
  const wrapped = concat(k.encPbPrefix, encPb, k.encPbSuffix);
  const xored = encryptEncPb(wrapped);
  const bBuf = concat(xored, k.aoSuffix);

  // 5) PKCS7 pad + AES-128-CBC (no padding)
  const aesIn = pkcs7Pad(bBuf, 16);
  const cipher = await aesCbcNoPad(aesIn, k.aesKey, k.aesIv);

  // 6) prepend 2B header, base64
  return bytesToBase64(concat(k.cipherPrefix, cipher));
}

// SM3-based hashes used for fields 13/14 of the xargus_bean.

const ZERO16 = new Uint8Array(16);

export function getBodyHash(stub: string | null | undefined): Uint8Array {
  if (!stub || stub.length === 0) return sm3(ZERO16).subarray(0, 6);
  return sm3(hexToBytes(stub)).subarray(0, 6);
}

export function getQueryHash(query: string | null | undefined): Uint8Array {
  if (!query || query.length === 0) return sm3(ZERO16).subarray(0, 6);
  return sm3(new TextEncoder().encode(query)).subarray(0, 6);
}

// Compose the xargus_bean and call encryptArgus.
// Mirrors final_php/Argus.php :: getSign.
export interface ArgusInput {
  queryString: string;
  xSsStub: string | null;        // md5 hex of postData, or null
  timestamp: number;             // unix seconds
  aid?: number;
  licenseId?: number;
  platform?: number;
  deviceId?: string;
  installId?: string;
  secDeviceId?: string;
  sdkVersion?: string;
  sdkVersionInt?: number;
  versionName?: string;
}

export async function argusSign(input: ArgusInput, k?: ArgusConstants): Promise<string> {
  const aid = input.aid ?? 1967;
  const licenseId = input.licenseId ?? 1611921764;
  const platform = input.platform ?? 0;
  const sdkVersion = input.sdkVersion ?? 'v04.04.05-ov-android';
  const sdkVersionInt = input.sdkVersionInt ?? 134744640;
  const sec = input.secDeviceId ?? '';

  const params = new URLSearchParams(input.queryString);
  const deviceId = input.deviceId || params.get('device_id') || '';
  const installId = input.installId || params.get('iid') || '';
  const versionName = input.versionName ?? params.get('version_name') ?? '';

  const bean: { [k: number]: ProtoValue } = {
    1: 1077940818,
    2: 2,
    3: Math.floor(Math.random() * 0x80000000),
    4: String(aid),
    5: deviceId,
    6: String(licenseId),
    7: versionName,
    8: sdkVersion,
    9: sdkVersionInt,
    10: new Uint8Array(8),         // 8 zero bytes
    11: platform,
    12: (input.timestamp << 1) >>> 0,
    13: getBodyHash(input.xSsStub),
    14: getQueryHash(input.queryString),
    15: { 1: 1, 2: 1, 3: 1, 7: 0xc792eccc },
    16: sec,
    20: 'none',
    21: 738,
    23: { 1: 'NX551J', 2: 8196, 4: 0x80e0d800 },
    25: 2,
  };

  return encryptArgus(bean, k);
}
