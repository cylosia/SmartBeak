
import { FlagService } from './flags';

// Mock pool with configurable query results
function createMockPool(queryResult: { rows: Array<{ value: boolean }> } = { rows: [] }) {
  return {
    query: jest.fn().mockResolvedValue(queryResult),
  } as any;
}

describe('FlagService', () => {
  describe('isEnabled', () => {
    it('returns false when flag key is not found in database (fail-closed)', async () => {
      const pool = createMockPool({ rows: [] });
      const service = new FlagService(pool);

      const result = await service.isEnabled('unknown_flag');

      expect(result).toBe(false);
    });

    it('returns stored value when flag exists and is true', async () => {
      const pool = createMockPool({ rows: [{ value: true }] });
      const service = new FlagService(pool);

      const result = await service.isEnabled('existing_flag');

      expect(result).toBe(true);
    });

    it('returns stored value when flag exists and is false', async () => {
      const pool = createMockPool({ rows: [{ value: false }] });
      const service = new FlagService(pool);

      const result = await service.isEnabled('disabled_flag');

      expect(result).toBe(false);
    });

    it('uses parameterized query to prevent SQL injection', async () => {
      const pool = createMockPool({ rows: [] });
      const service = new FlagService(pool);

      await service.isEnabled('my_flag');

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT value FROM system_flags WHERE key=$1',
        ['my_flag']
      );
    });

    it('validates flag key format', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await expect(service.isEnabled('')).rejects.toThrow('Invalid flag key');
      await expect(service.isEnabled('invalid key!')).rejects.toThrow('Invalid flag key');
      await expect(service.isEnabled('a'.repeat(101))).rejects.toThrow('Invalid flag key');
    });

    it('accepts valid flag key characters', async () => {
      const pool = createMockPool({ rows: [] });
      const service = new FlagService(pool);

      // Should not throw for valid keys
      await service.isEnabled('valid_flag-key');
      await service.isEnabled('flag123');
      await service.isEnabled('UPPER_CASE');

      expect(pool.query).toHaveBeenCalledTimes(3);
    });
  });

  describe('set', () => {
    it('inserts a new flag with parameterized query', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await service.set('new_flag', true);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO system_flags'),
        ['new_flag', true]
      );
    });

    it('uses ON CONFLICT for upsert behavior', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await service.set('existing_flag', false);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        ['existing_flag', false]
      );
    });

    it('validates flag key on set', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await expect(service.set('', true)).rejects.toThrow('Invalid flag key');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('validates flag value is boolean', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await expect(service.set('key', 'true' as any)).rejects.toThrow('Invalid flag value');
      await expect(service.set('key', 1 as any)).rejects.toThrow('Invalid flag value');
      await expect(service.set('key', null as any)).rejects.toThrow('Invalid flag value');
    });
  });
});
