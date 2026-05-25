// Random + hex helpers used by device registration.
// Mirrors final_php/DevicePoolManager.php :: generateUuid, generateRandomString,
// androidRandomUUID, androidReverseHex, reverseHex.

const HEX_CHARS = 'abcdef0123456789';
const ALPHANUM = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const UPPER_ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

function randInt(maxExclusive: number): number {
  const u32 = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return u32 % maxExclusive;
}

export function randomFromAlphabet(alphabet: string, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[randInt(alphabet.length)];
  return s;
}

/** UUID v4-ish; matches PHP `androidRandomUUID` lowercase output. */
export function randomUuidLower(): string {
  const r = crypto.getRandomValues(new Uint16Array(8));
  const a = [...r];
  a[3] = (a[3]! & 0x0fff) | 0x4000; // version 4
  a[4] = (a[4]! & 0x3fff) | 0x8000; // variant
  const h = (n: number) => n.toString(16).padStart(4, '0');
  return `${h(a[0]!)}${h(a[1]!)}-${h(a[2]!)}-${h(a[3]!)}-${h(a[4]!)}-${h(a[5]!)}${h(a[6]!)}${h(a[7]!)}`;
}

export function randomDeviceType(): string {
  return randomFromAlphabet(LETTERS, 5) + randomFromAlphabet(DIGITS, 2);
}

export function randomOpenudid(): string {
  return randomFromAlphabet(HEX_CHARS, 40);
}

export function randomIvAscii(): string {
  return randomFromAlphabet(ALPHANUM, 16);
}

export function randomUpperAlphanum(length: number): string {
  return randomFromAlphabet(UPPER_ALPHANUM, length);
}

/**
 * deviceId → reverse-pair hex string, mirrors PHP `androidReverseHex`.
 *
 * PHP path: dechex($deviceId) → left-pad to 32 chars → walk backwards in
 * 2-char chunks → concat. Result is 32 hex chars representing the LE bytes
 * of the deviceId padded to 16 bytes total width.
 *
 * deviceId comes in as a string (i.snssdk.com returns it as 18-19 digit
 * numeric string). We use BigInt to avoid Number precision loss.
 */
export function androidReverseHex(deviceId: string | number | bigint): string {
  const n = typeof deviceId === 'bigint' ? deviceId : BigInt(deviceId);
  const hex = n.toString(16).padStart(32, '0');
  let out = '';
  for (let i = hex.length; i > 0; i -= 2) out += hex.substring(i - 2, i);
  return out;
}
