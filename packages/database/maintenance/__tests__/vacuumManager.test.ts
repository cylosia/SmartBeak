/**
 * VacuumManager Tests
 *
 * Tests for SQL injection prevention via table name validation, numeric config
 * validation, vacuum operation lifecycle, maintenance scheduling, and the
 * runVacuumMaintenance orchestrator. Documents current behavior of database
 * maintenance infrastructure.
 */

const mockLoggerInstance = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

jest.mock('@kernel/logger', () => ({
  getLogger: jest.fn(() => mockLoggerInstance),
}));

import type { Knex } from 'knex';
import {
  vacuumAnalyzeTable,
  analyzeTable,
  runVacuumMaintenance,
  formatVacuumStats,
  getVacuumSchedule,
  getTableAutovacuumConfig,
  setTableAutovacuumConfig,
} from '../vacuumManager';
import type { VacuumStatistics } from '../types';

/**
 * Create a mock Knex instance with chainable raw() and insert().
 * knex.raw('??', [tableName]) returns an object with toString() for identifier quoting.
 * All other knex.raw() calls return a resolved Promise with { rows: [] }.
 */
function createMockKnex() {
  const mockInsert = jest.fn().mockResolvedValue([1]);
  const mockTableBuilder = jest.fn().mockReturnValue({ insert: mockInsert });

  const mockRaw = jest.fn().mockImplementation((sql: string, params?: unknown[]) => {
    // Handle knex.raw('??', [tableName]).toString() - used for identifier quoting
    if (sql === '??') {
      const identifier = Array.isArray(params) ? String(params[0]) : 'table';
      return {
        toString: () => `"${identifier}"`,
        then: (resolve: (v: unknown) => void) => resolve({ rows: [] }),
      };
    }
    return Promise.resolve({ rows: [] });
  });

  const knex = Object.assign(mockTableBuilder, {
    raw: mockRaw,
  }) as unknown as Knex & {
    raw: jest.Mock;
  };

  return { knex, mockRaw, mockInsert, mockTableBuilder };
}

describe('VacuumManager', () => {
  describe('validateTableName (via vacuumAnalyzeTable)', () => {
    let knex: Knex & { raw: jest.Mock };

    beforeEach(() => {
      const mocks = createMockKnex();
      knex = mocks.knex as Knex & { raw: jest.Mock };
    });

    it('should accept valid lowercase table names', async () => {
      const result = await vacuumAnalyzeTable(knex, 'audit_events');
      expect(result.success).toBe(true);
    });

    it('should accept table names starting with underscore', async () => {
      const result = await vacuumAnalyzeTable(knex, '_temp_table');
      expect(result.success).toBe(true);
    });

    it('should accept table names with digits', async () => {
      const result = await vacuumAnalyzeTable(knex, 'table_v2');
      expect(result.success).toBe(true);
    });

    // validateTableName throws BEFORE the try/catch in vacuumAnalyzeTable,
    // so invalid names cause the function to reject, not return {success: false}
    it('should reject SQL injection via single quote', async () => {
      await expect(
        vacuumAnalyzeTable(knex, "users'; DROP TABLE users;--")
      ).rejects.toThrow('Invalid table name format');
    });

    it('should reject SQL injection via double dash comment', async () => {
      await expect(
        vacuumAnalyzeTable(knex, 'users--')
      ).rejects.toThrow('Invalid table name format');
    });

    it('should reject table names with uppercase letters', async () => {
      await expect(
        vacuumAnalyzeTable(knex, 'UserTable')
      ).rejects.toThrow('Invalid table name format');
    });

    it('should reject table names with spaces', async () => {
      await expect(
        vacuumAnalyzeTable(knex, 'my table')
      ).rejects.toThrow('Invalid table name format');
    });

    it('should reject table names with semicolons', async () => {
      await expect(
        vacuumAnalyzeTable(knex, 'users;')
      ).rejects.toThrow('Invalid table name format');
    });

    it('should reject empty string table name', async () => {
      await expect(
        vacuumAnalyzeTable(knex, '')
      ).rejects.toThrow('Table name is required');
    });

    it('should reject table names exceeding 63 characters', async () => {
      const longName = 'a'.repeat(64);
      await expect(
        vacuumAnalyzeTable(knex, longName)
      ).rejects.toThrow('exceeds PostgreSQL maximum identifier length');
    });

    it('should accept table names at exactly 63 characters', async () => {
      const maxName = 'a'.repeat(63);
      const result = await vacuumAnalyzeTable(knex, maxName);
      expect(result.success).toBe(true);
    });

    it('should reject table names starting with a digit', async () => {
      await expect(
        vacuumAnalyzeTable(knex, '1table')
      ).rejects.toThrow('Invalid table name format');
    });

    it('should reject table names with dots (schema-qualified)', async () => {
      await expect(
        vacuumAnalyzeTable(knex, 'public.users')
      ).rejects.toThrow('Invalid table name format');
    });

    it('should reject table names with backslash', async () => {
      await expect(
        vacuumAnalyzeTable(knex, 'users\\drop')
      ).rejects.toThrow('Invalid table name format');
    });

    it('should reject table names with null byte', async () => {
      await expect(
        vacuumAnalyzeTable(knex, 'users\0drop')
      ).rejects.toThrow('Invalid table name format');
    });
  });

  describe('validateNumericConfig (via setTableAutovacuumConfig)', () => {
    let knex: Knex & { raw: jest.Mock };
    let mockRaw: jest.Mock;

    beforeEach(() => {
      const mocks = createMockKnex();
      knex = mocks.knex as Knex & { raw: jest.Mock };
      mockRaw = mocks.mockRaw;
    });

    it('should accept valid numeric config values', async () => {
      mockRaw.mockResolvedValue({});

      await expect(
        setTableAutovacuumConfig(knex, 'users', {
          autovacuum_vacuum_scale_factor: 0.1,
          autovacuum_vacuum_threshold: 50,
        })
      ).resolves.toBeUndefined();

      expect(mockRaw).toHaveBeenCalledWith(
        expect.stringContaining('ALTER TABLE'),
        expect.arrayContaining(['users', 0.1, 50])
      );
    });

    it('should reject NaN config values', async () => {
      await expect(
        setTableAutovacuumConfig(knex, 'users', {
          autovacuum_vacuum_scale_factor: NaN,
        })
      ).rejects.toThrow('Invalid numeric value');
    });

    it('should reject Infinity config values', async () => {
      await expect(
        setTableAutovacuumConfig(knex, 'users', {
          autovacuum_vacuum_threshold: Infinity,
        })
      ).rejects.toThrow('Invalid numeric value');
    });

    it('should reject negative Infinity config values', async () => {
      await expect(
        setTableAutovacuumConfig(knex, 'users', {
          autovacuum_vacuum_cost_limit: -Infinity,
        })
      ).rejects.toThrow('Invalid numeric value');
    });

    it('should do nothing when no config options provided', async () => {
      await setTableAutovacuumConfig(knex, 'users', {});
      expect(mockRaw).not.toHaveBeenCalled();
    });

    it('should validate table name before processing config', async () => {
      await expect(
        setTableAutovacuumConfig(knex, 'INVALID TABLE', {
          autovacuum_vacuum_threshold: 50,
        })
      ).rejects.toThrow('Invalid table name format');
    });
  });

  describe('vacuumAnalyzeTable', () => {
    let knex: Knex & { raw: jest.Mock };
    let mockRaw: jest.Mock;

    beforeEach(() => {
      const mocks = createMockKnex();
      knex = mocks.knex as Knex & { raw: jest.Mock };
      mockRaw = mocks.mockRaw;
    });

    it('should execute VACUUM ANALYZE by default', async () => {
      const result = await vacuumAnalyzeTable(knex, 'test_table');

      expect(result.success).toBe(true);
      expect(result.operation).toBe('VACUUM ANALYZE');

      // Verify vacuum command was called (one of the raw calls)
      const vacuumCall = mockRaw.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).startsWith('VACUUM')
      );
      expect(vacuumCall).toBeDefined();
    });

    it('should execute VACUUM FULL when full option is true', async () => {
      const result = await vacuumAnalyzeTable(knex, 'test_table', { full: true });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('VACUUM FULL');
    });

    it('should set and reset statement_timeout around vacuum', async () => {
      await vacuumAnalyzeTable(knex, 'test_table');

      // Should have SET statement_timeout call
      const setTimeoutCall = mockRaw.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('SET statement_timeout')
      );
      expect(setTimeoutCall).toBeDefined();
      expect(setTimeoutCall[1]).toEqual([300000]); // 5 minute default

      // Should have RESET statement_timeout call
      const resetCall = mockRaw.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('RESET statement_timeout')
      );
      expect(resetCall).toBeDefined();
    });

    it('should return failure result when vacuum command throws', async () => {
      // Use mockImplementation for fine-grained control
      let callCount = 0;
      mockRaw.mockImplementation((sql: string, params?: unknown[]) => {
        if (sql === '??') {
          const id = Array.isArray(params) ? String(params[0]) : 'table';
          return { toString: () => `"${id}"` };
        }
        callCount++;
        // 1: getTableVacuumStats before, 2: SET timeout, 3: VACUUM (fail)
        if (callCount === 3) {
          return Promise.reject(new Error('lock timeout'));
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await vacuumAnalyzeTable(knex, 'test_table');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Vacuum failed');
      expect(result.message).toContain('lock timeout');
      expect(result.error).toBeInstanceOf(Error);
    });

    it('should include dead tuple counts in success message', async () => {
      let callCount = 0;
      mockRaw.mockImplementation((sql: string, params?: unknown[]) => {
        if (sql === '??') {
          const id = Array.isArray(params) ? String(params[0]) : 'table';
          return { toString: () => `"${id}"` };
        }
        callCount++;
        // Call order: 1=before stats, 2=SET timeout, 3=VACUUM, 4=RESET timeout, 5=after stats
        if (callCount === 1) {
          return Promise.resolve({ rows: [{ dead_tuples: 5000 }] });
        }
        if (callCount === 5) {
          return Promise.resolve({ rows: [{ dead_tuples: 0 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await vacuumAnalyzeTable(knex, 'test_table');

      expect(result.success).toBe(true);
      expect(result.message).toContain('5000');
      expect(result.message).toContain('0');
    });

    it('should report duration_ms in result', async () => {
      const result = await vacuumAnalyzeTable(knex, 'test_table');
      expect(typeof result.duration_ms).toBe('number');
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('analyzeTable', () => {
    let knex: Knex & { raw: jest.Mock };
    let mockRaw: jest.Mock;

    beforeEach(() => {
      const mocks = createMockKnex();
      knex = mocks.knex as Knex & { raw: jest.Mock };
      mockRaw = mocks.mockRaw;
    });

    it('should execute ANALYZE command', async () => {
      const result = await analyzeTable(knex, 'test_table');

      expect(result.success).toBe(true);
      expect(result.operation).toBe('ANALYZE');
      expect(result.message).toBe('Statistics updated successfully');
    });

    // analyzeTable also calls validateTableName before try/catch, so it throws
    it('should reject invalid table names', async () => {
      await expect(
        analyzeTable(knex, 'DROP TABLE users')
      ).rejects.toThrow('Invalid table name format');
    });

    it('should handle analyze failure gracefully', async () => {
      let callCount = 0;
      mockRaw.mockImplementation((sql: string, params?: unknown[]) => {
        if (sql === '??') {
          const id = Array.isArray(params) ? String(params[0]) : 'table';
          return { toString: () => `"${id}"` };
        }
        callCount++;
        // 1=SET timeout, 2=ANALYZE (fail)
        if (callCount === 2) {
          return Promise.reject(new Error('permission denied'));
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await analyzeTable(knex, 'test_table');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Analyze failed');
    });
  });

  describe('runVacuumMaintenance', () => {
    let knex: Knex & { raw: jest.Mock };
    let mockRaw: jest.Mock;

    beforeEach(() => {
      const mocks = createMockKnex();
      knex = mocks.knex as Knex & { raw: jest.Mock };
      mockRaw = mocks.mockRaw;
    });

    it('should return check metadata in dry run without executing vacuum', async () => {
      const result = await runVacuumMaintenance(knex, { dryRun: true });

      expect(result.checked_at).toBeInstanceOf(Date);
      expect(result.results).toHaveLength(0);
    });

    it('should skip tables with invalid names from db_vacuum_statistics', async () => {
      // getTablesNeedingVacuum returns a table with invalid name
      mockRaw.mockImplementation((sql: string, params?: unknown[]) => {
        if (sql === '??') {
          const id = Array.isArray(params) ? String(params[0]) : 'table';
          return { toString: () => `"${id}"` };
        }
        if (typeof sql === 'string' && sql.includes('dead_tuple_ratio >=')) {
          return Promise.resolve({
            rows: [{ table_name: 'INVALID;DROP', dead_tuple_ratio: 50, dead_tuples: 5000 }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await runVacuumMaintenance(knex, {
        includeHighChurn: false,
      });

      // The invalid table should be skipped
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Skipping table with invalid name from db_vacuum_statistics',
        undefined,
        { table: 'INVALID;DROP' }
      );
      // No vacuum results since only table was invalid
      expect(result.results).toHaveLength(0);
    });

    it('should include high-churn tables by default', async () => {
      const result = await runVacuumMaintenance(knex);

      // High-churn tables are always included by default (6 tables)
      expect(result.results.length).toBeGreaterThanOrEqual(6);
    });

    it('should exclude high-churn tables when includeHighChurn is false', async () => {
      const result = await runVacuumMaintenance(knex, { includeHighChurn: false });

      expect(result.results).toHaveLength(0);
    });
  });

  describe('formatVacuumStats', () => {
    const baseStats: VacuumStatistics = {
      schemaname: 'public',
      table_name: 'users',
      live_tuples: 100000,
      dead_tuples: 5000,
      dead_tuple_ratio: 5,
      vacuum_count: 10,
      autovacuum_count: 50,
      analyze_count: 10,
      autoanalyze_count: 50,
    };

    it('should format OK status for low dead tuple ratio', () => {
      const result = formatVacuumStats({ ...baseStats, dead_tuple_ratio: 5 });
      expect(result).toContain('[OK]');
      expect(result).toContain('users');
      expect(result).toContain('5.00%');
    });

    it('should format WARNING status for moderate dead tuple ratio', () => {
      const result = formatVacuumStats({ ...baseStats, dead_tuple_ratio: 20 });
      expect(result).toContain('[WARNING]');
    });

    it('should format CRITICAL status for high dead tuple ratio', () => {
      const result = formatVacuumStats({ ...baseStats, dead_tuple_ratio: 35 });
      expect(result).toContain('[CRITICAL]');
    });

    it('should show "Never" when no vacuum has been performed', () => {
      const result = formatVacuumStats({ ...baseStats });
      expect(result).toContain('Never');
    });

    it('should show last autovacuum date when available', () => {
      const date = new Date('2026-01-15');
      const result = formatVacuumStats({
        ...baseStats,
        last_autovacuum: date,
      });
      expect(result).not.toContain('Never');
    });

    it('should prefer autovacuum date over manual vacuum date', () => {
      const autoDate = new Date('2026-01-20');
      const manualDate = new Date('2026-01-10');
      const result = formatVacuumStats({
        ...baseStats,
        last_autovacuum: autoDate,
        last_vacuum: manualDate,
      });
      // Should use autovacuum date (Jan 20) not manual date (Jan 10)
      const formatted = autoDate.toLocaleDateString();
      expect(result).toContain(formatted);
    });

    it('should threshold at exactly 15 for WARNING', () => {
      const result15 = formatVacuumStats({ ...baseStats, dead_tuple_ratio: 15 });
      const result14 = formatVacuumStats({ ...baseStats, dead_tuple_ratio: 14.99 });
      expect(result15).toContain('[WARNING]');
      expect(result14).toContain('[OK]');
    });

    it('should threshold at exactly 30 for CRITICAL', () => {
      const result30 = formatVacuumStats({ ...baseStats, dead_tuple_ratio: 30 });
      const result29 = formatVacuumStats({ ...baseStats, dead_tuple_ratio: 29.99 });
      expect(result30).toContain('[CRITICAL]');
      expect(result29).toContain('[WARNING]');
    });
  });

  describe('getVacuumSchedule', () => {
    it('should return high_churn schedule with 6-hour cron', () => {
      const schedule = getVacuumSchedule();
      expect(schedule.high_churn.cron).toBe('0 */6 * * *');
      expect(schedule.high_churn.tables).toContain('audit_events');
      expect(schedule.high_churn.tables).toContain('analytics_events');
    });

    it('should return medium_churn schedule with daily 2AM cron', () => {
      const schedule = getVacuumSchedule();
      expect(schedule.medium_churn.cron).toBe('0 2 * * *');
      expect(schedule.medium_churn.tables).toContain('content');
    });

    it('should return analyze_all schedule with weekly Sunday 3AM cron', () => {
      const schedule = getVacuumSchedule();
      expect(schedule.analyze_all.cron).toBe('0 3 * * 0');
    });
  });

  describe('getTableAutovacuumConfig', () => {
    let knex: Knex & { raw: jest.Mock };
    let mockRaw: jest.Mock;

    beforeEach(() => {
      const mocks = createMockKnex();
      knex = mocks.knex as Knex & { raw: jest.Mock };
      mockRaw = mocks.mockRaw;
    });

    it('should return null when table not found', async () => {
      mockRaw.mockResolvedValue({ rows: [] });
      const result = await getTableAutovacuumConfig(knex, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should parse reloptions into config object', async () => {
      mockRaw.mockResolvedValue({
        rows: [{
          relname: 'users',
          reloptions: [
            'autovacuum_vacuum_scale_factor=0.05',
            'autovacuum_vacuum_threshold=100',
            'autovacuum_analyze_scale_factor=0.02',
          ],
        }],
      });

      const result = await getTableAutovacuumConfig(knex, 'users');
      expect(result).toEqual({
        table_name: 'users',
        autovacuum_vacuum_scale_factor: 0.05,
        autovacuum_vacuum_threshold: 100,
        autovacuum_analyze_scale_factor: 0.02,
      });
    });

    it('should handle null reloptions', async () => {
      mockRaw.mockResolvedValue({
        rows: [{ relname: 'users', reloptions: null }],
      });

      const result = await getTableAutovacuumConfig(knex, 'users');
      expect(result).toEqual({ table_name: 'users' });
    });

    it('should skip malformed reloption entries without equals sign', async () => {
      mockRaw.mockResolvedValue({
        rows: [{
          relname: 'users',
          reloptions: ['malformed_entry', 'autovacuum_vacuum_threshold=200'],
        }],
      });

      const result = await getTableAutovacuumConfig(knex, 'users');
      expect(result).toEqual({
        table_name: 'users',
        autovacuum_vacuum_threshold: 200,
      });
    });
  });
});
