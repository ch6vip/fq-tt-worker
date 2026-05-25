// Minimal protobuf wire format encoder/decoder.
// Mirrors final_php/ProtoBuf.php + ProtoReader.php + ProtoWriter.php.
//
// Quirk to keep parity with PHP: writeVarint truncates to 32-bit before
// encoding (PHP source: `$_t96 = $vint & 0xFFFFFFFF`). Same for int values
// in encodeProto dicts. Argus uses this for `timestamp << 1` (field 12),
// which intentionally wraps to 32-bit.

export const TYPE_VARINT = 0;
export const TYPE_FIXED64 = 1;
export const TYPE_BYTES = 2;
export const TYPE_FIXED32 = 5;

export type ProtoValue =
  | number
  | bigint
  | string
  | Uint8Array
  | { [key: number]: ProtoValue };

export class ProtoWriter {
  private buf: Uint8Array;
  private pos = 0;

  constructor(initialSize = 256) {
    this.buf = new Uint8Array(initialSize);
  }

  private grow(needed: number): void {
    if (this.pos + needed <= this.buf.length) return;
    let newSize = this.buf.length * 2;
    while (newSize < this.pos + needed) newSize *= 2;
    const next = new Uint8Array(newSize);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  write(b: Uint8Array): void {
    this.grow(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  writeByte(b: number): void {
    this.grow(1);
    this.buf[this.pos++] = b & 0xff;
  }

  writeVarint(v: number): void {
    v = v >>> 0;
    while (v >= 0x80) {
      this.writeByte((v & 0x7f) | 0x80);
      v = v >>> 7;
    }
    this.writeByte(v & 0x7f);
  }

  writeInt32(v: number): void {
    this.grow(4);
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
    dv.setUint32(0, v >>> 0, true);
    this.pos += 4;
  }

  writeInt64(v: bigint): void {
    this.grow(8);
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    dv.setBigUint64(0, BigInt.asUintN(64, v), true);
    this.pos += 8;
  }

  writeString(b: Uint8Array): void {
    this.writeVarint(b.length);
    this.write(b);
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

export class ProtoReader {
  pos = 0;
  constructor(private data: Uint8Array) {}

  isRemain(n: number): boolean {
    return this.pos + n <= this.data.length;
  }

  read(n: number): Uint8Array {
    if (!this.isRemain(n)) throw new Error('ProtoReader: not enough data');
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  read0(): number {
    if (!this.isRemain(1)) throw new Error('ProtoReader: not enough data');
    return this.data[this.pos++]! & 0xff;
  }

  readVarint(): number {
    let v = 0, n = 0;
    while (true) {
      const b = this.read0();
      v |= (b & 0x7f) << (n * 7);
      if (b < 0x80) break;
      n++;
    }
    return v >>> 0;
  }

  readInt32(): number {
    const b = this.read(4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  }

  readInt64(): bigint {
    const b = this.read(8);
    return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
  }

  readString(): Uint8Array {
    return this.read(this.readVarint());
  }
}

export function encodeProto(dict: { [key: number]: ProtoValue }): Uint8Array {
  const w = new ProtoWriter();
  // PHP arrays with integer keys iterate in insertion order, but for the
  // xargus_bean dict the keys happen to already be sorted ascending (1..25).
  // We sort explicitly so engine-specific key iteration order can't bite us.
  const keys = Object.keys(dict).map(Number).sort((a, b) => a - b);
  for (const k of keys) writeField(w, k, dict[k]!);
  return w.toBytes();
}

function writeField(w: ProtoWriter, idx: number, v: ProtoValue): void {
  if (typeof v === 'number') {
    w.writeVarint((idx << 3) | TYPE_VARINT);
    w.writeVarint(v >>> 0);
  } else if (typeof v === 'bigint') {
    w.writeVarint((idx << 3) | TYPE_VARINT);
    w.writeVarint(Number(BigInt.asUintN(32, v)));
  } else if (typeof v === 'string') {
    const bytes = new TextEncoder().encode(v);
    w.writeVarint((idx << 3) | TYPE_BYTES);
    w.writeString(bytes);
  } else if (v instanceof Uint8Array) {
    w.writeVarint((idx << 3) | TYPE_BYTES);
    w.writeString(v);
  } else if (typeof v === 'object' && v !== null) {
    const nested = encodeProto(v);
    w.writeVarint((idx << 3) | TYPE_BYTES);
    w.writeString(nested);
  } else {
    throw new Error(`unsupported proto value at field ${idx}`);
  }
}
