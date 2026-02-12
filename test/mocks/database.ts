/**
 * Test Mocks: Database Client
 * 
 * Provides mock PostgreSQL database implementation for testing.
 */

import { vi } from 'vitest';

export interface MockTable {
  [id: string]: Record<string, any>;
}

export interface MockDatabase {
  [tableName: string]: MockTable;
}

export interface MockDbOptions {
  initialData?: MockDatabase;
}

export function createMockDatabase(options: MockDbOptions = {}) {
  const data: MockDatabase = options.initialData || {};
  const transactionActive = { value: false };

  const query = vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
    // Simulate basic SQL operations for testing
    const normalizedSql = sql.toLowerCase().trim();

    // SELECT operations
    if (normalizedSql.startsWith('select')) {
      // Extract table name
      const tableMatch = normalizedSql.match(/from\s+(\w+)/);
      if (tableMatch) {
        const tableName = tableMatch[1];
        return { rows: Object.values(data[tableName] || {}) };
      }
      return { rows: [] };
    }

    // INSERT operations
    if (normalizedSql.startsWith('insert')) {
      const tableMatch = normalizedSql.match(/into\s+(\w+)/);
      if (tableMatch && params) {
        const tableName = tableMatch[1];
        if (!data[tableName]) data[tableName] = {};
        
        // Generate ID
        const id = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        data[tableName][id] = { id, ...paramsToObject(params) };
        
        return { rows: [{ id }], rowCount: 1 };
      }
    }

    // UPDATE operations
    if (normalizedSql.startsWith('update')) {
      const tableMatch = normalizedSql.match(/update\s+(\w+)/);
      if (tableMatch) {
        const _tableName = tableMatch[1];
        // Simple update logic - in real tests, use actual query parsing
        return { rowCount: 1 };
      }
    }

    // DELETE operations
    if (normalizedSql.startsWith('delete')) {
      const tableMatch = normalizedSql.match(/from\s+(\w+)/);
      if (tableMatch) {
        return { rowCount: 1 };
      }
    }

    // Transaction commands
    if (normalizedSql === 'begin') {
      transactionActive.value = true;
      return {};
    }
    if (normalizedSql === 'commit') {
      transactionActive.value = false;
      return {};
    }
    if (normalizedSql === 'rollback') {
      transactionActive.value = false;
      return {};
    }

    return { rows: [] };
  });

  const mockClient = {
    query,
    release: vi.fn(),
  };

  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    query,
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    totalCount: 10,
    idleCount: 5,
    waitingCount: 0,
    options: { max: 10 },
  };

  const knexBuilder = (_tableName: string) => ({
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    select: vi.fn().mockImplementation(async () => {
      return Object.values(data[tableName] || {});
    }),
    first: vi.fn().mockImplementation(async () => {
      const rows = Object.values(data[tableName] || {});
      return rows[0] || null;
    }),
    insert: vi.fn().mockImplementation(async (record: any) => {
      if (!data[tableName]) data[tableName] = {};
      const id = `mock-${Date.now()}`;
      data[tableName][id] = { id, ...record };
      return [id];
    }),
    update: vi.fn().mockImplementation(async (updates: any) => {
      const rows = Object.values(data[tableName] || {});
      rows.forEach(row => Object.assign(row, updates));
      return rows.length;
    }),
    delete: vi.fn().mockImplementation(async () => {
      const count = Object.keys(data[tableName] || {}).length;
      data[tableName] = {};
      return count;
    }),
    count: vi.fn().mockReturnThis(),
    join: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    transacting: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    transaction: vi.fn().mockImplementation(async (callback: any) => {
      const trx = {
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
      };
      return await callback(trx);
    }),
  });

  const mockKnex = vi.fn().mockImplementation((tableName: string) => knexBuilder(tableName));
  Object.assign(mockKnex, {
    raw: vi.fn().mockImplementation(async (_sql: string, _bindings?: any[]) => {
      return { rows: [] };
    }),
    transaction: vi.fn().mockImplementation(async (callback: any) => {
      const trx = {
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
      };
      return await callback(trx);
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  });

  return {
    pool: mockPool,
    client: mockClient,
    knex: mockKnex as any,
    _data: data,
    _clear: () => {
      Object.keys(data).forEach(key => delete data[key]);
    },
    _getTable: (name: string) => data[name] || {},
    _setData: (newData: MockDatabase) => {
      Object.assign(data, newData);
    },
  };
}

function paramsToObject(params: any[]): Record<string, any> {
  // Convert array params to object based on position
  const result: Record<string, any> = {};
  params.forEach((param, index) => {
    result[`param${index + 1}`] = param;
  });
  return result;
}

export type MockDb = ReturnType<typeof createMockDatabase>;
