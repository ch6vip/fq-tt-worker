import type { Device } from './device/pool.js';
import type { DeviceGroupStats, DevicePoolStore, StatsStore } from './platform.js';

export interface EdgeOneKV {
  get(key: string, options?: { type: 'text' | 'json' | 'arrayBuffer' | 'stream' } | 'json'): Promise<unknown>;
  put(key: string, value: unknown, options?: { expirationTtl?: number; expiration?: number }): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(options?: { limit?: number; prefix?: string; cursor?: string }): Promise<{
    keys?: Array<{ key?: string; name?: string; expiration?: number }>;
    complete?: boolean;
    list_complete?: boolean;
    cursor?: string | null;
  }>;
}

interface StoredDevice extends Device {
  platform: 'android';
  last_used: number;
  use_count: number;
  created_at: number;
  status: 'ready' | 'failed';
}

interface ApiStat {
  api: string;
  call_count: number;
  last_called: number;
}

interface HourlyStat {
  api: string;
  hour_bucket: number;
  success_count: number;
  fail_count: number;
}

async function getJson<T>(kv: EdgeOneKV, key: string): Promise<T | null> {
  const value = await kv.get(key, { type: 'json' });
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

async function putJson(kv: EdgeOneKV, key: string, value: unknown): Promise<void> {
  await kv.put(key, JSON.stringify(value));
}

async function listAllKeys(kv: EdgeOneKV, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const options: { limit: number; prefix: string; cursor?: string } = { prefix, limit: 256 };
    if (cursor) options.cursor = cursor;
    const page = await kv.list(options);
    const keys = Array.isArray(page.keys) ? page.keys : [];
    for (const key of keys) {
      const name = key.key ?? key.name;
      if (name) names.push(name);
    }
    const complete = page.complete ?? page.list_complete ?? true;
    cursor = complete ? undefined : (page.cursor ?? undefined);
  } while (cursor);
  return names;
}

export class EdgeOneKVDevicePool implements DevicePoolStore {
  constructor(private kv: EdgeOneKV) {}

  private key(deviceId: string): string {
    return `device:${deviceId}`;
  }

  private async listDevices(): Promise<StoredDevice[]> {
    const keys = await listAllKeys(this.kv, 'device:');
    const rows = await Promise.all(keys.map(key => getJson<StoredDevice>(this.kv, key)));
    return rows.filter((row): row is StoredDevice => !!row);
  }

  async pickDevice(waitUntil?: (p: Promise<unknown>) => void): Promise<Device | null> {
    const devices = await this.listDevices();
    const selected = devices
      .filter(d => d.platform === 'android' && d.status === 'ready')
      .sort((a, b) => a.last_used - b.last_used)[0];
    if (!selected) return null;
    const touch = this.touchDevice(selected.device_id);
    if (waitUntil) waitUntil(touch);
    else await touch;
    return {
      device_id: selected.device_id,
      install_id: selected.install_id,
      secret_key: selected.secret_key,
    };
  }

  async touchDevice(deviceId: string): Promise<void> {
    const key = this.key(deviceId);
    const row = await getJson<StoredDevice>(this.kv, key);
    if (!row) return;
    row.last_used = Date.now();
    row.use_count = (row.use_count ?? 0) + 1;
    await putJson(this.kv, key, row);
  }

  async markFailed(deviceId: string): Promise<void> {
    const key = this.key(deviceId);
    const row = await getJson<StoredDevice>(this.kv, key);
    if (!row) return;
    row.status = 'failed';
    await putJson(this.kv, key, row);
  }

  async insert(d: Device): Promise<void> {
    const now = Date.now();
    await putJson(this.kv, this.key(d.device_id), {
      ...d,
      platform: 'android',
      last_used: 0,
      use_count: 0,
      created_at: now,
      status: 'ready',
    } satisfies StoredDevice);
  }

  async countReady(): Promise<number> {
    const devices = await this.listDevices();
    return devices.filter(d => d.platform === 'android' && d.status === 'ready').length;
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const devices = await this.listDevices();
    let removed = 0;
    for (const d of devices) {
      if (d.status === 'failed' || (d.last_used > 0 && d.last_used < cutoff)) {
        await this.kv.delete(this.key(d.device_id));
        removed++;
      }
    }
    return removed;
  }

  async groupStats(): Promise<DeviceGroupStats[]> {
    const groups = new Map<string, DeviceGroupStats>();
    for (const d of await this.listDevices()) {
      const g = groups.get(d.status) ?? { status: d.status, count: 0, oldest: d.created_at, newest: d.created_at };
      g.count++;
      g.oldest = Math.min(g.oldest, d.created_at);
      g.newest = Math.max(g.newest, d.created_at);
      groups.set(d.status, g);
    }
    return [...groups.values()];
  }
}

export class EdgeOneKVStats implements StatsStore {
  constructor(private kv: EdgeOneKV) {}

  private apiKey(api: string): string {
    return `stats:api:${encodeURIComponent(api)}`;
  }

  private hourlyKey(api: string, bucket: number): string {
    return `stats:hour:${bucket}:${encodeURIComponent(api)}`;
  }

  async record(api: string): Promise<void> {
    const key = this.apiKey(api);
    const row = await getJson<ApiStat>(this.kv, key) ?? { api, call_count: 0, last_called: 0 };
    row.call_count++;
    row.last_called = Date.now();
    await putJson(this.kv, key, row);
  }

  async recordHourlyHit(api: string): Promise<void> {
    const bucket = Math.floor(Date.now() / 3600000) * 3600;
    const key = this.hourlyKey(api, bucket);
    const row = await getJson<HourlyStat>(this.kv, key) ?? {
      api,
      hour_bucket: bucket,
      success_count: 0,
      fail_count: 0,
    };
    row.success_count++;
    await putJson(this.kv, key, row);
  }

  async snapshot(): Promise<Array<{ api: string; call_count: number; last_called: number }>> {
    const keys = await listAllKeys(this.kv, 'stats:api:');
    const rows = await Promise.all(keys.map(key => getJson<ApiStat>(this.kv, key)));
    return rows
      .filter((row): row is ApiStat => !!row)
      .sort((a, b) => b.call_count - a.call_count)
      .map(({ api, call_count, last_called }) => ({ api, call_count, last_called }));
  }

  async totalCalls(): Promise<number> {
    const rows = await this.snapshot();
    return rows.reduce((sum, row) => sum + row.call_count, 0);
  }

  async todayCalls(): Promise<number> {
    const todayStart = Math.floor(Date.now() / 86400000) * 86400;
    const keys = await listAllKeys(this.kv, 'stats:hour:');
    const rows = await Promise.all(keys.map(key => getJson<HourlyStat>(this.kv, key)));
    return rows
      .filter((row): row is HourlyStat => !!row && row.hour_bucket >= todayStart)
      .reduce((sum, row) => sum + row.success_count + row.fail_count, 0);
  }

  async cleanupHourly(retentionMs = 7 * 24 * 3600 * 1000): Promise<number> {
    const cutoff = Math.floor((Date.now() - retentionMs) / 3600000) * 3600;
    const keys = await listAllKeys(this.kv, 'stats:hour:');
    let removed = 0;
    for (const key of keys) {
      const row = await getJson<HourlyStat>(this.kv, key);
      if (row && row.hour_bucket < cutoff) {
        await this.kv.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async getMeta(key: string): Promise<number | null> {
    const value = await this.kv.get(`meta:${key}`);
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async setMeta(key: string, value: number, mode: 'upsert' | 'insert-if-missing' = 'upsert'): Promise<void> {
    const kvKey = `meta:${key}`;
    if (mode === 'insert-if-missing' && await this.kv.get(kvKey) != null) return;
    await this.kv.put(kvKey, String(value));
  }
}

export async function probeKV(kv: EdgeOneKV): Promise<unknown> {
  const key = `probe:${Date.now()}`;
  const value = String(Math.floor(Math.random() * 1_000_000));
  await kv.put(key, value);
  const readBack = await kv.get(key);
  await kv.delete(key);
  return { key, value, readBack };
}
