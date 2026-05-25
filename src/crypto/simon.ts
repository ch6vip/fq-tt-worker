// Simon128/256 (64-bit blocks, 4×64-bit key, 72 rounds).
// Mirrors final_php/Simon.php — same z-sequence, same per-round function.

const MASK64 = 0xffffffffffffffffn;
const Z_SEQ = 0x3dc94c3a046d678bn; // 62-bit constant Z_4

function rotl64(v: bigint, n: number): bigint {
  n &= 63;
  if (n === 0) return v & MASK64;
  const b = BigInt(n);
  return (((v << b) & MASK64) | (v >> BigInt(64 - n))) & MASK64;
}

function rotr64(v: bigint, n: number): bigint {
  n &= 63;
  if (n === 0) return v & MASK64;
  const b = BigInt(n);
  return ((v >> b) | ((v << BigInt(64 - n)) & MASK64)) & MASK64;
}

export function expandKey(k: readonly [bigint, bigint, bigint, bigint]): bigint[] {
  const key = [k[0] & MASK64, k[1] & MASK64, k[2] & MASK64, k[3] & MASK64];
  for (let i = 4; i < 72; i++) {
    let tmp = rotr64(key[i - 1]!, 3);
    tmp = (tmp ^ key[i - 3]!) & MASK64;
    tmp = (tmp ^ rotr64(tmp, 1)) & MASK64;
    const notVal = (~key[i - 4]!) & MASK64;
    const bit = (Z_SEQ >> BigInt((i - 4) % 62)) & 1n;
    key.push((notVal ^ tmp ^ bit ^ 3n) & MASK64);
  }
  return key;
}

export function simonEncWithSchedule(
  pt: readonly [bigint, bigint],
  schedule: bigint[],
  c: 0 | 1 = 0,
): [bigint, bigint] {
  let xi = pt[0] & MASK64;
  let xi1 = pt[1] & MASK64;
  for (let i = 0; i < 72; i++) {
    const tmp = xi1;
    const f = c === 1
      ? rotl64(xi1, 1)
      : (rotl64(xi1, 1) & rotl64(xi1, 8)) & MASK64;
    xi1 = (xi ^ f ^ rotl64(xi1, 2) ^ schedule[i]!) & MASK64;
    xi = tmp;
  }
  return [xi, xi1];
}

export function simonEnc(
  pt: readonly [bigint, bigint],
  k: readonly [bigint, bigint, bigint, bigint],
  c: 0 | 1 = 0,
): [bigint, bigint] {
  return simonEncWithSchedule(pt, expandKey(k), c);
}

