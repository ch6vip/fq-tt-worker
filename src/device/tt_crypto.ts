// tt-flavored encryption used by device registration.
// Mirrors final_php/DevicePoolManager.php :: ttEncrypt + androidDecryptKey
// + helpers (getHashKey, getAesKeyAndIv).

const TT_MAGIC = new Uint8Array([0x74, 0x63, 0x05, 0x10, 0x00, 0x00]);

const TT_FIXED_STRING = (() => {
  const b64 = 'TdTC5rgxYgkOUrPHpnM7pByyRiuCmrWKGWs521cXdST0m69/COjWjSanLjfBqVovHwWlGJKu8pSXMrYqOKrdWA==';
  return base64ToBytes(b64);
})();

// AES-128 master key for decrypting the /reading/crypt/registerkey response.
const REGISTERKEY_MASTER_KEY = hexToBytes('ac25c67ddd8f38c1b37a2348828e222e');

// AES-128 key used to encrypt the device_id sent to /reading/crypt/registerkey.
const REGISTERKEY_REQUEST_KEY = base64ToBytes('rCXGfd2POMGzeiNIgo4iLg==');

// Two 64-byte XOR-derived tables for hash_key. Used by getAesKeyAndIv (currently
// reserved for upstream changes; ttEncrypt itself uses a different KDF).
const HASH_KEY_BYTE1 = new Uint8Array([
  31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95,
  96, 81, 127, 169, 25, 181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239,
  160, 224, 59, 77, 174, 42, 245, 176, 200, 235, 187, 60, 131, 83, 153, 97,
  23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33, 12, 125,
]);
const HASH_KEY_BYTE2 = new Uint8Array([
  82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251,
  124, 227, 57, 130, 155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203,
  84, 123, 148, 50, 166, 194, 35, 61, 238, 76, 149, 11, 66, 250, 195, 78,
  8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109, 139, 209, 37,
]);

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function sha512(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-512', b));
}

async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concat(...chunks);
}

export function getHashKey(): Uint8Array {
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) out[i] = HASH_KEY_BYTE1[i]! ^ HASH_KEY_BYTE2[i]!;
  return out;
}

export async function getAesKeyAndIv(randomData: Uint8Array): Promise<{ key: Uint8Array; iv: Uint8Array }> {
  const randSha = await sha512(randomData);
  const data = concat(randSha, getHashKey());
  const hash = await sha512(data);
  return { key: hash.subarray(0, 16), iv: hash.subarray(16, 32) };
}

/**
 * ttEncrypt's internal KDF — exposed so unit tests can pin the byte-for-byte
 * derivation against the PHP oracle. The full ttEncrypt output is non-
 * deterministic (random_bytes) AND its ciphertext depends on the gzip
 * implementation's compression level (PHP uses level 9; CompressionStream is
 * unspecified), so we only oracle-test this KDF, not the full envelope.
 */
export async function deriveTtKdf(randomBytes: Uint8Array): Promise<{ key: Uint8Array; iv: Uint8Array }> {
  if (randomBytes.length !== 32) throw new Error('randomBytes must be 32 bytes');
  const rndSha = await sha512(randomBytes);
  const kdfInput = concat(rndSha, TT_FIXED_STRING);
  const hash = await sha512(kdfInput);
  return { key: hash.subarray(0, 16), iv: hash.subarray(16, 32) };
}

/**
 * tt-flavored payload encryption for device_register.
 *
 * Layout: 6B magic || 32B random || AES-128-CBC(SHA512(gz) || gz, k, iv)
 * where k/iv = SHA512(SHA512(random) || TT_FIXED_STRING)[0..32].
 *
 * AES padding is the openssl default (PKCS7), same as the PHP version —
 * Web Crypto's `AES-CBC` defaults to PKCS7 as well, so no padding trick
 * is needed here (unlike Argus).
 */
export async function ttEncrypt(
  data: Uint8Array | string,
  randomBytes?: Uint8Array,
): Promise<Uint8Array> {
  const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const rnd = randomBytes ?? crypto.getRandomValues(new Uint8Array(32));
  if (rnd.length !== 32) throw new Error('ttEncrypt: randomBytes must be 32 bytes');

  const rndSha = await sha512(rnd);
  const kdfInput = concat(rndSha, TT_FIXED_STRING);
  const hashValue = await sha512(kdfInput);
  const aesKey = hashValue.subarray(0, 16);
  const aesIv = hashValue.subarray(16, 32);

  const compressed = await gzipCompress(dataBytes);
  const dataSha = await sha512(compressed);
  const hashed = concat(dataSha, compressed);

  const ck = await crypto.subtle.importKey('raw', aesKey, { name: 'AES-CBC' }, false, ['encrypt']);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: aesIv }, ck, hashed),
  );

  return concat(TT_MAGIC, rnd, encrypted);
}

/**
 * Decrypt the `data.key` field returned by /reading/crypt/registerkey.
 *
 * Layout: base64(16B iv || ciphertext).  AES-128-CBC under a fixed master key.
 *
 * PHP used OPENSSL_ZERO_PADDING + manual PKCS7 strip. Web Crypto can't disable
 * PKCS7, so we let it strip PKCS7 — works iff upstream encrypts with PKCS7
 * (the standard openssl default). If upstream sends ZERO_PADDING ciphertext
 * (raw 16-byte aligned with no padding) this will throw; fall back logic
 * would need a hand-rolled AES-128 ECB. Not yet observed in production.
 *
 * @returns raw decrypted bytes, or null on any failure
 */
export async function androidDecryptKey(encryptedKey: string): Promise<Uint8Array | null> {
  const data = base64ToBytes(encryptedKey);
  if (data.length < 32) return null;
  const iv = data.subarray(0, 16);
  const ciphertext = data.subarray(16);

  try {
    const ck = await crypto.subtle.importKey(
      'raw', REGISTERKEY_MASTER_KEY, { name: 'AES-CBC' }, false, ['decrypt'],
    );
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, ciphertext),
    );
    return plain;
  } catch {
    return null;
  }
}

/**
 * Encrypt the device_id payload sent to /reading/crypt/registerkey.
 * Mirrors final_php/DevicePoolManager.php :: androidRegisterKeyAndGetSecret
 * lines 564-572.
 *
 * @param hexData  32-char hex of reversed deviceId bytes
 * @param iv       16-char ASCII iv (alphanumeric, NOT a 16-byte key — the
 *                 PHP version literally generates `mt_rand`'d chars and
 *                 feeds them as iv bytes)
 */
export async function registerKeyEncryptDeviceId(hexData: string, iv: string): Promise<Uint8Array> {
  const data = hexToBytes(hexData);
  const ivBytes = new TextEncoder().encode(iv);
  if (ivBytes.length !== 16) throw new Error('iv must be 16 ASCII chars');
  const ck = await crypto.subtle.importKey(
    'raw', REGISTERKEY_REQUEST_KEY, { name: 'AES-CBC' }, false, ['encrypt'],
  );
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: ivBytes }, ck, data),
  );
}
