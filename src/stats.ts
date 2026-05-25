export class StatsManager {
  constructor(private db: D1Database) {}

  async record(api: string): Promise<void> {
    const now = Date.now();
    await this.db.prepare(`
      INSERT INTO api_stats (api, call_count, last_called) VALUES (?1, 1, ?2)
      ON CONFLICT(api) DO UPDATE
        SET call_count = call_count + 1, last_called = ?2
    `).bind(api, now).run();
  }

  async recordHourlyHit(api: string): Promise<void> {
    const bucket = Math.floor(Date.now() / 3600000) * 3600;
    await this.db.prepare(`
      INSERT INTO api_stats_hourly (api, hour_bucket, success_count, fail_count)
      VALUES (?1, ?2, 1, 0)
      ON CONFLICT(api, hour_bucket) DO UPDATE
        SET success_count = success_count + 1
    `).bind(api, bucket).run();
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
}
