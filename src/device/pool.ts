// Device pool — D1-backed, replaces final_php/DevicePoolManager.php.
//
// Design notes vs. PHP version:
//   - PHP picked by sorting the whole pool in PHP-land then writing the whole
//     JSON back, racy under concurrency. We use UPDATE...RETURNING so the
//     atomic SQLite row lock decides who gets each device.
//   - PHP triggered registerAndroidDevice synchronously inside getDevice when
//     the pool was below minPoolSize, blocking the request for several
//     seconds. Here cron handles refill; the request path never registers.
//   - PHP wrote last_used as a 'Y-m-d H:i:s' string; we use Date.now() ms.

import type { DeviceGroupStats, DevicePoolStore } from '../platform.js';

export interface Device {
  device_id: string;
  install_id: string;
  secret_key: string;
}

export class DevicePoolManager implements DevicePoolStore {
  constructor(private db: D1Database) {}

  /**
   * Atomically pick the least-recently-used ready device. Returns null on
   * empty pool — caller should 503 rather than wait.
   *
   * Two flavors:
   *   - default (no callback): UPDATE+RETURNING in one statement; strongly
   *     atomic but every call counts against D1 write quota (~25 ops/s).
   *   - with `waitUntil` callback: SELECT synchronously, then schedule the
   *     last_used/use_count update for after the response is sent. Lets the
   *     handler return in ~5ms while writes happen in the background. Comes
   *     at the cost of best-effort concurrency (two simultaneous picks may
   *     return the same device in the gap between SELECT and the UPDATE
   *     landing), matching the PHP original's behavior — selecting the same
   *     device twice doesn't break anything, the LRU just degrades slightly.
   */
  async pickDevice(waitUntil?: (p: Promise<unknown>) => void): Promise<Device | null> {
    if (!waitUntil) {
      // Strict mode — single atomic statement.
      const { results } = await this.db.prepare(`
        UPDATE devices
        SET last_used = ?1, use_count = use_count + 1
        WHERE device_id = (
          SELECT device_id FROM devices
          WHERE platform = 'android' AND status = 'ready'
          ORDER BY last_used ASC
          LIMIT 1
        )
        RETURNING device_id, install_id, secret_key
      `).bind(Date.now()).all<Device>();
      return results.length > 0 ? results[0]! : null;
    }

    // Fast mode — read on the critical path, write deferred via waitUntil.
    const row = await this.db.prepare(`
      SELECT device_id, install_id, secret_key
      FROM devices
      WHERE platform = 'android' AND status = 'ready'
      ORDER BY last_used ASC
      LIMIT 1
    `).first<Device>();
    if (!row) return null;
    waitUntil(this.touchDevice(row.device_id).catch(e => {
      console.warn(`touchDevice(${row.device_id}) failed:`, (e as Error).message);
    }));
    return row;
  }

  /** Bump last_used + use_count for a device. Used by the fast pickDevice path. */
  async touchDevice(deviceId: string): Promise<void> {
    await this.db.prepare(`
      UPDATE devices
      SET last_used = ?, use_count = use_count + 1
      WHERE device_id = ?
    `).bind(Date.now(), deviceId).run();
  }

  /** Soft-fail a device so cron will replace it on the next tick. */
  async markFailed(deviceId: string): Promise<void> {
    await this.db.prepare(
      `UPDATE devices SET status = 'failed' WHERE device_id = ?`
    ).bind(deviceId).run();
  }

  /** Insert a freshly-registered device. */
  async insert(d: Device): Promise<void> {
    await this.db.prepare(`
      INSERT INTO devices (device_id, install_id, secret_key, created_at, last_used, status)
      VALUES (?, ?, ?, ?, 0, 'ready')
    `).bind(d.device_id, d.install_id, d.secret_key, Date.now()).run();
  }

  /** Count ready devices — cron uses this to decide whether to top up. */
  async countReady(): Promise<number> {
    const row = await this.db.prepare(`
      SELECT COUNT(*) AS n FROM devices WHERE platform = 'android' AND status = 'ready'
    `).first<{ n: number }>();
    return row?.n ?? 0;
  }

  /** Drop failed devices + ones idle for > maxAgeMs. */
  async cleanup(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const r = await this.db.prepare(`
      DELETE FROM devices
      WHERE status = 'failed'
         OR (last_used > 0 AND last_used < ?)
    `).bind(cutoff).run();
    return r.meta.changes ?? 0;
  }

  async groupStats(): Promise<DeviceGroupStats[]> {
    const { results } = await this.db.prepare(`
      SELECT status, COUNT(*) as count, MIN(created_at) as oldest, MAX(created_at) as newest
      FROM devices GROUP BY status
    `).all<DeviceGroupStats>();
    return results;
  }
}

/**
 * Register a brand-new Android device.
 * Implementation lives in ./register.ts so this file stays small.
 * Always call from scheduled() — latency is several seconds.
 */
export { registerAndroidDevice } from './register.js';
export type { RegisteredDevice } from './register.js';
