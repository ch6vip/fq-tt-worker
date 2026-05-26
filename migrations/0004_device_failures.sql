CREATE TABLE device_failures (
  reason     TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_seen  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_device_failures_last_seen ON device_failures(last_seen);
