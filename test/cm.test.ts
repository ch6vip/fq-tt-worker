// CM (Diffie-Hellman 2048-bit) oracle test — used by FullEndpoint.

import { describe, test, expect } from 'vitest';
import { CM } from '../src/crypto/cm.js';

const FIXED_PRIV = 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefn;

describe('CM clientHandshake (vs PHP oracle, fixed private key)', () => {
  test('matches PHP byte-for-byte', async () => {
    const cm = new CM(FIXED_PRIV);
    const hs = await cm.clientHandshake();
    expect(hs).toBe(
      'AAAAAAAAAAAAAAAAAAAAAKjPFzmFoZjMXi7n/3io6aMYX/28rLuUa3Sk5Lm1y+5iqM6PhjLBgNsTxWOCmRCDLBCCqSomGF6LCqtXC/y8RVKo6I9qCgObU7FHnxaB9FgBdPqH7QjnCJi6p1KVepoFiMVCdrv/jWyJDXJOQMjFM9gMzi9UUUn5BZPsx0TWGUprZV0hGwIC9m+cH/vNFYglpnvjv9Ozoy8NzkxoYeIs6qkHk5kJA0WSbVqcftL/HeEVt15Vp8DWS98ajL5uSajv6hxdOhLNARdZWCizS8fiiQY=',
    );
  });
});

describe('CM decrypt (vs PHP oracle)', () => {
  test('round-trip server-encrypted payload', async () => {
    const cm = new CM(FIXED_PRIV);
    const serverKey = 'qg8MvyRvhF/cxNTro81nLtVclLyCI4pr9VkkvPkA+ylMs+tVw9KKopMA5IBO9B+75ckS758neP3q/7ufr6Ws8jq/F+z9TU58fU6ueeMqXvbILVvx2nGJr8iMfHnNRpsALZ9bQLMhHPlKID4KGmc4SXRjoKnbq4MBcLJOLy8EJxcB1Vdt5vFQCjkGjTpyjiwDbzDi6/SiMbnd46MmQ9rOxF6gTLRQreliNWbPeBwCjFWdmbGd2jheQgiad/KCrK23';
    const content = 'ESIzRFVmd4iZAKq7zN3u/+dxzUqDrGX1Z02mN8v7okrNI3yV2di3BLQEu5uiBRV+';
    const decrypted = await cm.decrypt(serverKey, content);
    expect(decrypted).not.toBeNull();
    expect(new TextDecoder().decode(decrypted!).replace(/\x00+$/, '').replace(/[\x01-\x10]+$/, ''))
      .toBe('hello world content from server');
  });

  test('null on empty inputs', async () => {
    const cm = new CM(FIXED_PRIV);
    expect(await cm.decrypt('', 'abc')).toBeNull();
    expect(await cm.decrypt('abc', '')).toBeNull();
  });
});
