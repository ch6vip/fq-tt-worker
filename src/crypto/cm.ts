// CM — Diffie-Hellman handshake used by FullEndpoint.
// Mirrors final_php/CM.php.
//
// 2048-bit MODP group from RFC 3526. Each instance generates one ephemeral
// keypair, sends an AES-128-encrypted client public key, and uses the resulting
// shared secret (first 32 bytes) as an AES-256 key to decrypt server payloads.

// RFC 3526 group 14 — same as PHP CM::__construct.
const CM_PRIME = BigInt('0x' +
  'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74' +
  '020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f1437' +
  '4fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
  'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf05' +
  '98da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb' +
  '9ed529077096966d670c354e4abc9804f1746c08ca237327ffffffffffffffff');

const CM_BASE = 2n;
const CM_AES_KEY = base64ToBytes('rCXGfd2POMGzeiNIgo4iLg==');
const CM_IV = new Uint8Array(16); // 16 zero bytes

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let r = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return r;
}

function gmpToBytes(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function pkcs7Pad(data: Uint8Array, block = 16): Uint8Array {
  const pad = block - (data.length % block);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
}

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  const pad = data[data.length - 1]!;
  if (pad < 1 || pad > 16 || pad > data.length) return data;
  return data.subarray(0, data.length - pad);
}

async function aesCbcZeroPadEncrypt(plain: Uint8Array, key: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  if (plain.length % 16 !== 0) throw new Error('plain must be 16-aligned');
  const ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  const buf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, ck, plain);
  return new Uint8Array(buf).subarray(0, plain.length);
}

export class CM {
  private privateKey: bigint;
  private publicKey: bigint;

  /**
   * Construct a CM handshake.
   *
   * @param injectedPrivateKey  Optional deterministic private key for testing.
   *                            Production callers should omit it so a fresh
   *                            random key is generated per request.
   */
  constructor(injectedPrivateKey?: bigint) {
    if (injectedPrivateKey !== undefined) {
      this.privateKey = injectedPrivateKey % (CM_PRIME - 2n);
    } else {
      // privateKey = random_256_bits mod (prime - 2)
      const priv = bytesToBigInt(crypto.getRandomValues(new Uint8Array(32)));
      this.privateKey = priv % (CM_PRIME - 2n);
    }
    this.publicKey = modPow(CM_BASE, this.privateKey, CM_PRIME);
  }

  /** Build the `key` field of the handshake JSON: base64(iv || AES-CBC(pub, aesKey, iv)). */
  async clientHandshake(): Promise<string> {
    const y = gmpToBytes(this.publicKey);
    const padded = pkcs7Pad(y, 16);
    const encrypted = await aesCbcZeroPadEncrypt(padded, CM_AES_KEY, CM_IV);
    const combined = new Uint8Array(CM_IV.length + encrypted.length);
    combined.set(CM_IV);
    combined.set(encrypted, CM_IV.length);
    return bytesToBase64(combined);
  }

  /** Decrypt one chapter body using DH shared-secret-derived AES-256 key. */
  async decrypt(serverKey: string, contentB64: string): Promise<Uint8Array | null> {
    if (!serverKey || !contentB64) return null;
    const decoded = base64ToBytes(contentB64);
    if (decoded.length < 16) return null;
    const iv = decoded.subarray(0, 16);
    const ciphertext = decoded.subarray(16);

    const serverBytes = base64ToBytes(serverKey);
    const serverKeyLong = bytesToBigInt(serverBytes);
    const shared = modPow(serverKeyLong, this.privateKey, CM_PRIME);
    const sharedBytes = gmpToBytes(shared);
    const aesKey = sharedBytes.subarray(0, 32);
    if (aesKey.length < 32) return null;

    try {
      // PHP used ZERO_PADDING + manual PKCS7 unpad. With Web Crypto's mandatory
      // PKCS7 mode the result is the same when upstream encrypts with PKCS7.
      const ck = await crypto.subtle.importKey('raw', aesKey, { name: 'AES-CBC' }, false, ['decrypt']);
      const buf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, ciphertext);
      return new Uint8Array(buf);
    } catch {
      // Fallback for upstream that uses raw/ZERO_PADDING: do it manually.
      // Not easily done in Web Crypto; just bail.
      return null;
    }
  }
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}
