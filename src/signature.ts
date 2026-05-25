// Compose all signature headers — mirrors final_php/SignatureManager.php.
//
// Generates the six headers the upstream API expects:
//   x-ss-req-ticket  (ms timestamp string)
//   x-khronos        (s  timestamp string)
//   x-gorgon         (algorithm dependent: 0404 or 8404)
//   x-ss-stub        (md5 of POST body; omitted on GET)
//   x-ladon          (Ladon::encrypt of timestamp/license/aid)
//   x-argus          (Argus::getSign with the full xargus_bean)

import { md5Hex } from './crypto/md5.js';
import { gorgon } from './crypto/xgorgon.js';
import { ladonEncrypt } from './crypto/ladon.js';
import { argusSign, type ArgusConstants } from './crypto/argus.js';

export interface SignatureOptions {
  algorithm: '0404' | '8404';
  aid: number;
  licenseId: number;
  sdkVersion: string;
  sdkVersionInt: number;
  platform: number;
  argusConstants?: ArgusConstants;
}

export type SignatureHeaders = Record<string, string>;

export async function signRequest(
  queryString: string,
  postData: string | null,
  opts: SignatureOptions,
): Promise<SignatureHeaders> {
  const timestamp = Math.floor(Date.now() / 1000);
  const xSsStub = postData ? md5Hex(postData) : null;

  const aid = (() => {
    const v = new URLSearchParams(queryString).get('aid');
    return v ? parseInt(v, 10) : opts.aid;
  })();

  const g = gorgon(opts.algorithm, queryString, timestamp);

  let ladon: string | undefined;
  try {
    ladon = ladonEncrypt(timestamp, opts.licenseId, aid);
  } catch (e) {
    console.error('x-ladon failed:', (e as Error).message);
  }

  let argus: string | undefined;
  try {
    argus = await argusSign({
      queryString,
      xSsStub,
      timestamp,
      aid,
      licenseId: opts.licenseId,
      platform: opts.platform,
      sdkVersion: opts.sdkVersion,
      sdkVersionInt: opts.sdkVersionInt,
    }, opts.argusConstants);
  } catch (e) {
    console.error('x-argus failed:', (e as Error).message);
  }

  const headers: SignatureHeaders = {
    'x-ss-req-ticket': String(timestamp * 1000),
    'x-khronos': String(timestamp),
    'x-gorgon': g.x_gorgon,
  };
  if (xSsStub) headers['x-ss-stub'] = xSsStub;
  if (ladon)   headers['x-ladon']   = ladon;
  if (argus)   headers['x-argus']   = argus;
  return headers;
}
