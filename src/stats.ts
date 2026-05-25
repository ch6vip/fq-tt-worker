// Per-API call counters — replaces final_php/StatsManager.php (530 lines, mostly file IO).
// Schema lives in migrations/0001_init.sql as the `api_stats` table.

export class StatsManager {
  constructor(private db: D1Database) {}

  /** Bump call_count + last_called for an api name. Idempotent upsert. */
  async record(api: string): Promise<void> {
    const now = Date.now();
    await this.db.prepare(`
      INSERT INTO api_stats (api, call_count, last_called) VALUES (?1, 1, ?2)
      ON CONFLICT(api) DO UPDATE
        SET call_count = call_count + 1, last_called = ?2
    `).bind(api, now).run();
  }

  /** Sampled record: increments by 10 (called 10% of the time). Saves D1 writes. */
  async recordSampled(api: string): Promise<void> {
    const now = Date.now();
    await this.db.prepare(`
      INSERT INTO api_stats (api, call_count, last_called) VALUES (?1, 10, ?2)
      ON CONFLICT(api) DO UPDATE
        SET call_count = call_count + 10, last_called = ?2
    `).bind(api, now).run();
  }

  /** All counters, ordered by most-called first. */
  async snapshot(): Promise<Array<{ api: string; call_count: number; last_called: number }>> {
    const { results } = await this.db.prepare(
      `SELECT api, call_count, last_called FROM api_stats ORDER BY call_count DESC`,
    ).all<{ api: string; call_count: number; last_called: number }>();
    return results;
  }
}
