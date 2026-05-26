import type { ApiHealthSummary, StatsStore } from './platform.js';

export class StatsManager implements StatsStore {
  constructor(private db: D1Database) {}

  async record(api: string, count = 1): Promise<void> {
    const now = Date.now();
    await this.db.prepare(`
      INSERT INTO api_stats (api, call_count, last_called) VALUES (?1, ?2, ?3)
      ON CONFLICT(api) DO UPDATE
        SET call_count = call_count + ?2, last_called = ?3
    `).bind(api, count, now).run();
  }

  async recordHourlyHit(api: string, count = 1): Promise<void> {
    const bucket = Math.floor(Date.now() / 3600000) * 3600;
    await this.db.prepare(`
      INSERT INTO api_stats_hourly (api, hour_bucket, success_count, fail_count)
      VALUES (?1, ?2, ?3, 0)
      ON CONFLICT(api, hour_bucket) DO UPDATE
        SET success_count = success_count + ?3
    `).bind(api, bucket, count).run();
  }

  async recordHourlyFail(api: string, count = 1): Promise<void> {
    const bucket = Math.floor(Date.now() / 3600000) * 3600;
    await this.db.prepare(`
      INSERT INTO api_stats_hourly (api, hour_bucket, success_count, fail_count)
      VALUES (?1, ?2, 0, ?3)
      ON CONFLICT(api, hour_bucket) DO UPDATE
        SET fail_count = fail_count + ?3
    `).bind(api, bucket, count).run();
  }

  async apiHealthSummary(hours = 24, limit = 8): Promise<ApiHealthSummary[]> {
    const safeHours = Math.max(1, Math.min(168, Math.floor(hours)));
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const cutoff = Math.floor((Date.now() - safeHours * 3600 * 1000) / 3600000) * 3600;
    const { results } = await this.db.prepare(`
      SELECT
        api,
        COALESCE(SUM(success_count), 0) AS success_count,
        COALESCE(SUM(fail_count), 0) AS fail_count
      FROM api_stats_hourly
      WHERE hour_bucket >= ?
      GROUP BY api
      HAVING SUM(success_count + fail_count) > 0
      ORDER BY fail_count DESC, CAST(fail_count AS REAL) / SUM(success_count + fail_count) DESC, api ASC
      LIMIT ?
    `).bind(cutoff, safeLimit).all<{ api: string; success_count: number; fail_count: number }>();
    return results.map((row) => {
      const success = Number(row.success_count);
      const fail = Number(row.fail_count);
      const total = success + fail;
      return {
        api: row.api,
        success_count: success,
        fail_count: fail,
        total_count: total,
        fail_rate: total > 0 ? fail / total : 0,
      };
    });
  }

  async snapshot(): Promise<Array<{ api: string; call_count: number; last_called: number }>> {
    const { results } = await this.db.prepare(
      `SELECT api, call_count, last_called FROM api_stats ORDER BY call_count DESC`,
    ).all<{ api: string; call_count: number; last_called: number }>();
    return results;
  }

  async totalCalls(): Promise<number> {
    const r = await this.db.prepare(
      `SELECT COALESCE(SUM(call_count), 0) AS total FROM api_stats`
    ).first<{ total: number }>();
    return r?.total ?? 0;
  }

  async todayCalls(): Promise<number> {
    const todayStart = Math.floor(Date.now() / 86400000) * 86400;
    const r = await this.db.prepare(`
      SELECT COALESCE(SUM(success_count + fail_count), 0) AS total
      FROM api_stats_hourly
      WHERE hour_bucket >= ?
    `).bind(todayStart).first<{ total: number }>();
    return r?.total ?? 0;
  }

  async cleanupHourly(retentionMs = 7 * 24 * 3600 * 1000): Promise<number> {
    const cutoff = Math.floor((Date.now() - retentionMs) / 3600000) * 3600;
    const r = await this.db.prepare(
      `DELETE FROM api_stats_hourly WHERE hour_bucket < ?`
    ).bind(cutoff).run();
    return r.meta.changes ?? 0;
  }

  async getMeta(key: string): Promise<number | null> {
    const row = await this.db.prepare(
      `SELECT value FROM meta WHERE key = ?`
    ).bind(key).first<{ value: number | null }>();
    return row?.value ?? null;
  }

  async setMeta(key: string, value: number, mode: 'upsert' | 'insert-if-missing' = 'upsert'): Promise<void> {
    if (mode === 'insert-if-missing') {
      await this.db.prepare(
        `INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING`
      ).bind(key, value).run();
      return;
    }
    await this.db.prepare(
      `INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(key, value).run();
  }

  async recordDeviceFailure(reason: string, count = 1): Promise<void> {
    const safeReason = sanitizeFailureReason(reason);
    const now = Date.now();
    await this.db.prepare(`
      INSERT INTO device_failures (reason, fail_count, last_seen) VALUES (?1, ?2, ?3)
      ON CONFLICT(reason) DO UPDATE
        SET fail_count = fail_count + ?2, last_seen = ?3
    `).bind(safeReason, count, now).run();
  }

  async deviceFailureSummary(limit = 5): Promise<Array<{ reason: string; fail_count: number; last_seen: number }>> {
    const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
    const { results } = await this.db.prepare(`
      SELECT reason, fail_count, last_seen
      FROM device_failures
      ORDER BY fail_count DESC, last_seen DESC
      LIMIT ?
    `).bind(safeLimit).all<{ reason: string; fail_count: number; last_seen: number }>();
    return results;
  }
}

function sanitizeFailureReason(reason: string): string {
  return reason.replace(/\s+/g, ' ').trim().slice(0, 180) || 'unknown';
}
