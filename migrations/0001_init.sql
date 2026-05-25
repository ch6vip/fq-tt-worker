-- Device pool: replaces final_php/device_pool.json.
-- One row per registered Android device.
CREATE TABLE devices (
  device_id   TEXT PRIMARY KEY,
  platform    TEXT NOT NULL DEFAULT 'android',
  install_id  TEXT NOT NULL,
  secret_key  TEXT NOT NULL,                 -- 32 hex chars
  last_used   INTEGER NOT NULL DEFAULT 0,    -- unix ms
  use_count   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ready'  -- ready | failed
);

CREATE INDEX idx_devices_pick
  ON devices(platform, status, last_used);

-- API call counters (replaces final_php/api_stats.json).
CREATE TABLE api_stats (
  api         TEXT PRIMARY KEY,
  call_count  INTEGER NOT NULL DEFAULT 0,
  last_called INTEGER NOT NULL DEFAULT 0
);
