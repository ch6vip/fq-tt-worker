// Register a fresh Android device with i.snssdk.com, then fetch its secret_key
// from reading.snssdk.com. Mirrors final_php/DevicePoolManager.php ::
// registerAndroidDevice + androidRegisterKeyAndGetSecret + androidTryActivatePremium.
//
// CALL FROM CRON ONLY. End-to-end latency is 2-10 seconds (network + several
// upstream calls). Never invoke from a fetch() handler.

import { signRequest, type SignatureOptions } from '../signature.js';
import {
  ttEncrypt,
  androidDecryptKey,
  registerKeyEncryptDeviceId,
} from './tt_crypto.js';
import {
  androidReverseHex,
  randomDeviceType,
  randomOpenudid,
  randomIvAscii,
} from './util.js';

export interface RegisteredDevice {
  device_id: string;
  install_id: string;
  secret_key: string;          // 32 hex chars, uppercase
  device_type: string;         // for debugging
}

const DEVICE_REGISTER_URL = 'https://i.snssdk.com/service/2/device_register/';
const REGISTERKEY_URL = 'https://reading.snssdk.com/reading/crypt/registerkey';
const PREMIUM_URL = 'https://api5-normal-sinfonlinea.fqnovel.com/reading/user/privilege/add/v/';
const USER_AGENT_REGISTER = 'com.dragon.read';

interface DeviceRegisterResponse {
  device_id?: number | string;
  device_id_str?: string;
  install_id?: number | string;
  install_id_str?: string;
}

interface RegisterKeyResponse {
  data?: { key?: string };
}

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function bytesToHexUpper(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0').toUpperCase();
  return s;
}

/** Send the {header:{device_model, openudid, package}} payload to upstream. */
async function postDeviceRegister(deviceType: string, openudid: string): Promise<{ deviceId: string; installId: string }> {
  const payload = JSON.stringify({
    header: { device_model: deviceType, openudid, package: 'com.dragon.read' },
  });
  const encrypted = await ttEncrypt(payload);

  const res = await fetch(DEVICE_REGISTER_URL, {
    method: 'POST',
    body: encrypted,
    headers: { 'user-agent': USER_AGENT_REGISTER },
  });
  if (!res.ok) throw new Error(`device_register HTTP ${res.status}`);

  const body = await res.json() as DeviceRegisterResponse;
  const deviceId = body.device_id_str ?? (body.device_id != null ? String(body.device_id) : '');
  const installId = body.install_id_str ?? (body.install_id != null ? String(body.install_id) : '');
  if (!deviceId || !installId) {
    throw new Error(`device_register bad shape: ${JSON.stringify(body)}`);
  }
  return { deviceId, installId };
}

/** Best-effort premium activation. Failures are logged, not thrown. */
async function tryActivatePremium(deviceId: string, installId: string, deviceType: string): Promise<void> {
  const params = [
    'aid=1967',
    'app_name=novelapp',
    'channel=0',
    `device_id=${deviceId}`,
    'device_platform=android',
    `device_type=${deviceType}`,
    `iid=${installId}`,
    'os_version=0',
    'version_code=58932',
    'version_name=5.8.9.32',
    'manifest_version_code=58932',
    'update_version_code=58932',
  ].sort().join('&');

  const body = JSON.stringify({
    add_count_daily: 0,
    amount: 2592000,
    privilege_id: 7209298988466700640, // 0x641066F45BC01360 — exceeds Number.MAX_SAFE_INT but stored as number per PHP
    from: 8,
    unique_key: String(Date.now()),
  });

  try {
    const res = await fetch(`${PREMIUM_URL}?${params}`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    });
    if (!res.ok) console.warn(`premium activation HTTP ${res.status}`);
    else console.log('premium activation: ok');
  } catch (e) {
    console.warn('premium activation failed:', (e as Error).message);
  }
}

/** Encrypt deviceId, POST to /reading/crypt/registerkey, decrypt response → secret_key (32 hex upper). */
async function registerKeyAndGetSecret(
  deviceId: string,
  installId: string,
  sigOpts: SignatureOptions,
  maxRetries = 3,
): Promise<string | null> {
  const hexData = androidReverseHex(deviceId);
  const iv = randomIvAscii();
  const encrypted = await registerKeyEncryptDeviceId(hexData, iv);
  const ivBytes = new TextEncoder().encode(iv);
  const combined = new Uint8Array(ivBytes.length + encrypted.length);
  combined.set(ivBytes);
  combined.set(encrypted, ivBytes.length);
  const content = bytesToBase64(combined);

  const params = [
    'aid=1967', 'app_name=novelapp', 'channel=0',
    `device_id=${deviceId}`, 'device_platform=android', `iid=${installId}`,
    'os_version=0', 'version_code=5.8.9.32', 'version_name=5.8.9.32',
  ].sort().join('&');
  const url = `${REGISTERKEY_URL}?${params}`;

  const postJson = JSON.stringify({ content });

  let sigHeaders: Record<string, string> = {};
  try {
    sigHeaders = await signRequest(params, postJson, sigOpts);
  } catch (e) {
    console.warn('registerkey sign failed:', (e as Error).message);
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Workers fetch() doesn't reliably forward content-encoding: gzip on
      // outbound requests — send uncompressed JSON instead. The payload is
      // small (~120 bytes) so compression gains are negligible.
      const res = await fetch(url, {
        method: 'POST',
        body: postJson,
        headers: { 'user-agent': USER_AGENT_REGISTER, ...sigHeaders },
      });
      if (!res.ok) {
        console.warn(`registerkey HTTP ${res.status} (attempt ${attempt + 1}/${maxRetries})`);
        if (attempt + 1 < maxRetries) await sleep(1000);
        continue;
      }
      const respBody = await res.json() as RegisterKeyResponse;
      const encKey = respBody.data?.key;
      if (!encKey) {
        console.warn(`registerkey missing data.key: ${JSON.stringify(respBody).slice(0, 200)}`);
        if (attempt + 1 < maxRetries) await sleep(1000);
        continue;
      }
      const dec = await androidDecryptKey(encKey);
      if (!dec || dec.length === 0) {
        console.warn(`registerkey decrypt failed (attempt ${attempt + 1}/${maxRetries})`);
        if (attempt + 1 < maxRetries) await sleep(1000);
        continue;
      }
      return bytesToHexUpper(dec);
    } catch (e) {
      console.warn(`registerkey error (attempt ${attempt + 1}/${maxRetries}):`, (e as Error).message);
      if (attempt + 1 < maxRetries) await sleep(1000);
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Full registration flow. Returns null on failure (does NOT throw, so caller
 * cron loop can just try again next tick).
 */
export async function registerAndroidDevice(sigOpts: SignatureOptions): Promise<RegisteredDevice | null> {
  const deviceType = randomDeviceType();
  const openudid = randomOpenudid();
  console.log(`registering android device: device_type=${deviceType} openudid=${openudid}`);

  let deviceId: string, installId: string;
  try {
    ({ deviceId, installId } = await postDeviceRegister(deviceType, openudid));
  } catch (e) {
    console.error('device_register failed:', (e as Error).message);
    return null;
  }
  console.log(`device_register ok: device_id=${deviceId} install_id=${installId}`);

  // Premium activation is best-effort; PHP never let it abort the register.
  await tryActivatePremium(deviceId, installId, deviceType);

  const secretKey = await registerKeyAndGetSecret(deviceId, installId, sigOpts);
  if (!secretKey) {
    console.error(`secret_key fetch failed for device ${deviceId}`);
    return null;
  }
  console.log(`secret_key fetched for ${deviceId}`);

  return { device_id: deviceId, install_id: installId, secret_key: secretKey, device_type: deviceType };
}
