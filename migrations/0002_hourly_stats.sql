CREATE TABLE api_stats_hourly (
  api           TEXT NOT NULL,
  hour_bucket   INTEGER NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api, hour_bucket)
);

CREATE INDEX idx_hourly_bucket ON api_stats_hourly(hour_bucket);
