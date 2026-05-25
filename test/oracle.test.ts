// Oracle tests — every expected value was captured from the PHP reference
// implementation in E:/aaatest/fq-tt/final_php with concrete fixed inputs.
// If any of these tests fail, the TS port has diverged from byte-for-byte
// parity with the PHP that fq-tt has already proved works against the real
// upstream API.

import { describe, test, expect } from 'vitest';
import { sm3 } from '../src/crypto/sm3.js';
import { md5Hex } from '../src/crypto/md5.js';
import { gorgon0404, gorgon8404 } from '../src/crypto/xgorgon.js';
import { ladonEncrypt } from '../src/crypto/ladon.js';
import { encryptArgus, getBodyHash, getQueryHash } from '../src/crypto/argus.js';
import { encodeProto, ProtoReader, TYPE_VARINT, TYPE_BYTES } from '../src/crypto/protobuf.js';

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const PARAM = 'aid=1967&device_id=abc&iid=123';
const TS = 1700000000;

describe('SM3 (vs PHP oracle)', () => {
  test('"abc"',       () => expect(hex(sm3('abc'))).toBe('66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0'));
  test('empty',       () => expect(hex(sm3(''))).toBe('1ab21d8355cfa17f8e61194831e81a8f22bec8c728fefb747ed035eb5082aa2b'));
  test('64-byte "a"', () => expect(hex(sm3('a'.repeat(64)))).toBe('616ec433c359e7c2b19f360e2b8f2a1b6e9ed76b8dc1a7d207b31a5341c611e9'));
  test('query',       () => expect(hex(sm3(PARAM))).toBe('3c2869a3618f6a89cfe79b52431e070be3793f8825d22d87fc589c3eb7da3361'));
});

describe('MD5', () => {
  test('"abc"', () => expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72'));
  test('empty', () => expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e'));
});

describe('X-Gorgon (vs PHP oracle)', () => {
  test('0404', () =>
    expect(gorgon0404(PARAM, TS).x_gorgon).toBe('0404b0d30000105a4860eb57387ccee15dbc3694a6177ca72ddf'));

  test('8404 (rand=0xaabb)', () =>
    expect(gorgon8404(PARAM, TS, new Uint8Array([0xaa, 0xbb])).x_gorgon)
      .toBe('8404aabb0000fecb052dcc524ca16de1a1ce163f3bb62c082f8a'));
});

describe('Ladon (vs PHP oracle)', () => {
  test('rand=0x11223344', () =>
    expect(ladonEncrypt(TS, 1611921764, 1967, new Uint8Array([0x11, 0x22, 0x33, 0x44])))
      .toBe('ESIzRBOvMoBbQhXev1YT1IvQWkkUr0z1fIm4duijgcZOk7s+'));

  test('rand=0x00000000', () =>
    expect(ladonEncrypt(TS, 1611921764, 1967, new Uint8Array(4)))
      .toBe('AAAAAHbdL38A5HTUc4jMG+qgLqLq8kWRJIvAMRWmP55uC0Y5'));
});

describe('Argus subroutines (vs PHP oracle)', () => {
  test('getBodyHash(null)',  () => expect(hex(getBodyHash(null))).toBe('106e34a2b8c7'));
  test('getQueryHash(q)',    () => expect(hex(getQueryHash('aid=1967&device_id=devid-abc'))).toBe('0a58ab4a8a11'));
  test('getBodyHash(md5)',   () => expect(hex(getBodyHash(md5Hex('hello')))).toBe('e6f24df07298'));
});

describe('Argus encrypt (vs PHP oracle, fixed bean)', () => {
  test('full bean → base64', async () => {
    const bean = {
      1: 1077940818,
      2: 2,
      3: 0x12345678,
      4: '1967',
      5: 'devid-abc',
      6: '1611921764',
      7: '',
      8: 'v04.04.05-ov-android',
      9: 134744640,
      10: new Uint8Array(8),
      11: 0,
      12: (TS << 1) >>> 0,
      13: getBodyHash(null),
      14: getQueryHash('aid=1967&device_id=devid-abc'),
      15: { 1: 1, 2: 1, 3: 1, 7: 0xc792eccc },
      16: '',
      20: 'none',
      21: 738,
      23: { 1: 'NX551J', 2: 8196, 4: 0x80e0d800 },
      25: 2,
    };
    expect(await encryptArgus(bean)).toBe(
      '8oEW98egusY+LFvG7FFEoEjWcAaUPwMYvSaUAPMjZlDHFHUcSVXHdHxUCSKFwOx6p7BwbGd2LIhpTQJPZOHsFb43nsVDOJeO7KeIQpfN9Sej9mA6i5xlQwQWUk9MBpWfYTWxvRJD+fAUefrYH3CkfkApIsJ5RLKVjni68kgRwT5ukxHpHYXIKbMced+1YtVhHaL8Cd0sW2sU3ghdjQXWzkZJcfp9FddVMhZSvFTU/2QuCZLSLW3+m16zYeMbStf92q4=',
    );
  });
});

describe('ProtoBuf roundtrip (self-check)', () => {
  test('varint + bytes', () => {
    const enc = encodeProto({ 1: 12345, 2: 'hello' });
    const r = new ProtoReader(enc);

    const key1 = r.readVarint();
    expect(key1 >> 3).toBe(1);
    expect(key1 & 7).toBe(TYPE_VARINT);
    expect(r.readVarint()).toBe(12345);

    const key2 = r.readVarint();
    expect(key2 >> 3).toBe(2);
    expect(key2 & 7).toBe(TYPE_BYTES);
    expect(new TextDecoder().decode(r.readString())).toBe('hello');
  });
});
