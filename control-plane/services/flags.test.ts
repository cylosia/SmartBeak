
import { FlagService } from './flags';

// Mock pool with configurable query results
function createMockPool(queryResult: { rows: Array<{ value: boolean }> } = { rows: [] }) {
  return {
    query: jest.fn().mockResolvedValue(queryResult),
  } as any;
}

const TEST_ORG_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('FlagService', () => {
  describe('isEnabled', () => {
    it('returns false when flag key is not found in database (fail-closed)', async () => {
      const pool = createMockPool({ rows: [] });
      const service = new FlagService(pool);

      const result = await service.isEnabled('unknown_flag', TEST_ORG_ID);

      expect(result).toBe(false);
    });

    it('returns stored value when flag exists and is true', async () => {
      const pool = createMockPool({ rows: [{ value: true }] });
      const service = new FlagService(pool);

      const result = await service.isEnabled('existing_flag', TEST_ORG_ID);

      expect(result).toBe(true);
    });

    it('returns stored value when flag exists and is false', async () => {
      const pool = createMockPool({ rows: [{ value: false }] });
      const service = new FlagService(pool);

      const result = await service.isEnabled('disabled_flag', TEST_ORG_ID);

      expect(result).toBe(false);
    });

    it('scopes query to org_id to prevent cross-tenant flag reads', async () => {
      const pool = createMockPool({ rows: [] });
      const service = new FlagService(pool);

      await service.isEnabled('my_flag', TEST_ORG_ID);

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT value FROM system_flags WHERE key=$1 AND org_id=$2',
        ['my_flag', TEST_ORG_ID]
      );
    });

    it('validates flag key format', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await expect(service.isEnabled('', TEST_ORG_ID)).rejects.toThrow('Invalid flag key');
      await expect(service.isEnabled('invalid key!', TEST_ORG_ID)).rejects.toThrow('Invalid flag key');
      await expect(service.isEnabled('a'.repeat(101), TEST_ORG_ID)).rejects.toThrow('Invalid flag key');
    });

    it('accepts valid flag key characters', async () => {
      const pool = createMockPool({ rows: [] });
      const service = new FlagService(pool);

      // Should not throw for valid keys
      await service.isEnabled('valid_flag-key', TEST_ORG_ID);
      await service.isEnabled('flag123', TEST_ORG_ID);
      await service.isEnabled('UPPER_CASE', TEST_ORG_ID);

      expect(pool.query).toHaveBeenCalledTimes(3);
    });
  });

  describe('set', () => {
    it('inserts a new flag with parameterized query including org_id', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await service.set('new_flag', true, TEST_ORG_ID);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO system_flags'),
        ['new_flag', true, TEST_ORG_ID]
      );
    });

    it('uses ON CONFLICT scoped to (org_id, key) for safe upsert', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await service.set('existing_flag', false, TEST_ORG_ID);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (org_id, key)'),
        ['existing_flag', false, TEST_ORG_ID]
      );
    });

    it('validates flag key on set', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await expect(service.set('', true, TEST_ORG_ID)).rejects.toThrow('Invalid flag key');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('validates flag value is boolean', async () => {
      const pool = createMockPool();
      const service = new FlagService(pool);

      await expect(service.set('key', 'true' as any, TEST_ORG_ID)).rejects.toThrow('Invalid flag value');
      await expect(service.set('key', 1 as any, TEST_ORG_ID)).rejects.toThrow('Invalid flag value');
      await expect(service.set('key', null as any, TEST_ORG_ID)).rejects.toThrow('Invalid flag value');
    });
  });
});
