/**
 * Test Mocks: Redis Client
 * 
 * Provides mock Redis implementation for testing without external dependencies.
 */

import { vi } from 'vitest';

export interface MockRedisOptions {
  initialData?: Map<string, { value: string; expires: number }>;
}

export function createMockRedis(options: MockRedisOptions = {}) {
  const data = options.initialData || new Map();

  return {
    get: vi.fn().mockImplementation(async (key: string) => {
      const entry = data.get(key);
      if (!entry) return null;
      if (entry.expires < Date.now()) {
        data.delete(key);
        return null;
      }
      return entry.value;
    }),

    set: vi.fn().mockImplementation(async (key: string, value: string) => {
      data.set(key, { value, expires: Infinity });
      return 'OK';
    }),

    setex: vi.fn().mockImplementation(async (key: string, seconds: number, value: string) => {
      data.set(key, { value, expires: Date.now() + seconds * 1000 });
      return 'OK';
    }),

    del: vi.fn().mockImplementation(async (key: string) => {
      const existed = data.has(key);
      data.delete(key);
      return existed ? 1 : 0;
    }),

    keys: vi.fn().mockImplementation(async (pattern: string) => {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return Array.from(data.keys()).filter(k => regex.test(k));
    }),

    exists: vi.fn().mockImplementation(async (...keys: string[]) => {
      return keys.filter(k => data.has(k)).length;
    }),

    expire: vi.fn().mockImplementation(async (key: string, seconds: number) => {
      const entry = data.get(key);
      if (!entry) return 0;
      entry.expires = Date.now() + seconds * 1000;
      return 1;
    }),

    ttl: vi.fn().mockImplementation(async (key: string) => {
      const entry = data.get(key);
      if (!entry) return -2;
      if (entry.expires === Infinity) return -1;
      return Math.ceil((entry.expires - Date.now()) / 1000);
    }),

    lpush: vi.fn().mockImplementation(async (key: string, value: string) => {
      const entry = data.get(key);
      const list = entry ? JSON.parse(entry.value) : [];
      list.unshift(value);
      data.set(key, { value: JSON.stringify(list), expires: Infinity });
      return list.length;
    }),

    rpop: vi.fn().mockImplementation(async (key: string) => {
      const entry = data.get(key);
      if (!entry) return null;
      const list = JSON.parse(entry.value);
      const value = list.pop();
      data.set(key, { value: JSON.stringify(list), expires: entry.expires });
      return value;
    }),

    llen: vi.fn().mockImplementation(async (key: string) => {
      const entry = data.get(key);
      if (!entry) return 0;
      const list = JSON.parse(entry.value);
      return list.length;
    }),

    zadd: vi.fn().mockImplementation(async (key: string, score: number, member: string) => {
      const entry = data.get(key);
      const sortedSet = entry ? new Map(JSON.parse(entry.value)) : new Map();
      sortedSet.set(member, score);
      data.set(key, { 
        value: JSON.stringify(Array.from(sortedSet.entries())), 
        expires: Infinity 
      });
      return 1;
    }),

    zcard: vi.fn().mockImplementation(async (key: string) => {
      const entry = data.get(key);
      if (!entry) return 0;
      const sortedSet = new Map(JSON.parse(entry.value));
      return sortedSet.size;
    }),

    zremrangebyscore: vi.fn().mockImplementation(async (key: string, min: number, max: number) => {
      const entry = data.get(key);
      if (!entry) return 0;
      const sortedSet = new Map(JSON.parse(entry.value));
      let removed = 0;
      for (const [member, score] of sortedSet.entries()) {
        if (score >= min && score <= max) {
          sortedSet.delete(member);
          removed++;
        }
      }
      data.set(key, { 
        value: JSON.stringify(Array.from(sortedSet.entries())), 
        expires: entry.expires 
      });
      return removed;
    }),

    zrange: vi.fn().mockImplementation(async (key: string, start: number, stop: number, withScores?: string) => {
      const entry = data.get(key);
      if (!entry) return [];
      const sortedSet = new Map(JSON.parse(entry.value));
      const entries = Array.from(sortedSet.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(start, stop === -1 ? undefined : stop + 1);
      
      if (withScores === 'WITHSCORES') {
        return entries.flat();
      }
      return entries.map(e => e[0]);
    }),

    pipeline: vi.fn().mockReturnThis(),
    
    exec: vi.fn().mockResolvedValue([]),

    flushdb: vi.fn().mockImplementation(async () => {
      data.clear();
      return 'OK';
    }),

    quit: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    once: vi.fn(),
    
    // Expose data for test verification
    _data: data,
    _clear: () => data.clear(),
  };
}

export type MockRedis = ReturnType<typeof createMockRedis>;
