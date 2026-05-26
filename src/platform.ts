import type { Device } from './device/pool.js';

export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface DeviceGroupStats {
  status: string;
  count: number;
  oldest: number;
  newest: number;
}

export interface DevicePoolStore {
  pickDevice(waitUntil?: (p: Promise<unknown>) => void): Promise<Device | null>;
  markFailed(deviceId: string): Promise<void>;
  insert(device: Device): Promise<void>;
  countReady(): Promise<number>;
  cleanup(maxAgeMs: number): Promise<number>;
  groupStats(): Promise<DeviceGroupStats[]>;
}

export interface StatsStore {
  record(api: string, count?: number): Promise<void>;
  recordHourlyHit(api: string, count?: number): Promise<void>;
  snapshot(): Promise<Array<{ api: string; call_count: number; last_called: number }>>;
  totalCalls(): Promise<number>;
  todayCalls(): Promise<number>;
  cleanupHourly(retentionMs?: number): Promise<number>;
  getMeta(key: string): Promise<number | null>;
  setMeta(key: string, value: number, mode?: 'upsert' | 'insert-if-missing'): Promise<void>;
}
