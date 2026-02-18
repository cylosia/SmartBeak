
import { OnboardingService, OnboardingStep } from './onboarding';

// Mock pg Pool — supports both pool.query() (for mark/reset/ensure)
// and pool.connect() + client (for get(), which wraps in a REPEATABLE READ transaction).
function createMockPool() {
  const queryResults: Array<{ rows: unknown[]; rowCount: number }> = [];
  const queryCalls: Array<{ text: string; values: unknown[] }> = [];

  // Client returned by pool.connect() — shares the result queue with pool.query
  const createMockClient = () => ({
    query: jest.fn(async (text: string, values?: unknown[]) => {
      queryCalls.push({ text, values: values ?? [] });
      return queryResults.shift() ?? { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  });

  const pool = {
    query: jest.fn(async (text: string, values?: unknown[]) => {
      queryCalls.push({ text, values: values ?? [] });
      return queryResults.shift() ?? { rows: [], rowCount: 0 };
    }),
    connect: jest.fn(async () => createMockClient()),
    _setResults(results: Array<{ rows: unknown[]; rowCount: number }>) {
      queryResults.length = 0;
      queryResults.push(...results);
    },
    _getCalls() {
      return queryCalls;
    },
    _reset() {
      queryResults.length = 0;
      queryCalls.length = 0;
      pool.query.mockClear();
      pool.connect.mockClear();
    },
  };

  return pool;
}

// Helper: default result entries consumed by get()'s transaction preamble
// (BEGIN, SET TRANSACTION, _ensure INSERT, SELECT) with no auto-completion.
function getSetupResults(selectRow: unknown) {
  return [
    { rows: [], rowCount: 0 },   // BEGIN
    { rows: [], rowCount: 0 },   // SET TRANSACTION ISOLATION LEVEL REPEATABLE READ
    { rows: [], rowCount: 1 },   // _ensure INSERT ON CONFLICT DO NOTHING
    { rows: selectRow ? [selectRow] : [], rowCount: selectRow ? 1 : 0 }, // SELECT
    { rows: [], rowCount: 0 },   // COMMIT
  ];
}

describe('OnboardingService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: OnboardingService;

  beforeEach(() => {
    pool = createMockPool();
    service = new OnboardingService(pool as any);
  });

  afterEach(() => {
    pool._reset();
  });

  describe('constructor', () => {
    test('creates service with pool', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(OnboardingService);
    });
  });

  describe('validateStep (via mark)', () => {
    test('accepts valid steps: step_create_domain, step_create_content, step_publish_content', async () => {
      const validSteps: OnboardingStep[] = ['step_create_domain', 'step_create_content', 'step_publish_content'];
      for (const step of validSteps) {
        pool._reset();
        pool._setResults([{ rows: [], rowCount: 1 }]);
        await expect(service.mark('org-123', step)).resolves.not.toThrow();
      }
    });

    test('rejects invalid step names', async () => {
      await expect(service.mark('org-123', 'invalid' as OnboardingStep)).rejects.toThrow('Invalid step');
    });

    test('rejects old step names that no longer exist', async () => {
      for (const old of ['profile', 'billing', 'team']) {
        await expect(service.mark('org-123', old as OnboardingStep)).rejects.toThrow('Invalid step');
      }
    });

    test('rejects SQL injection attempts via step parameter', async () => {
      const injectionAttempts = [
        "step_create_domain; DROP TABLE org_onboarding--",
        "step_create_domain = true, admin",
        "' OR '1'='1",
        'step_create_domain"; DELETE FROM org_onboarding; --',
      ];
      for (const attempt of injectionAttempts) {
        await expect(service.mark('org-123', attempt as OnboardingStep)).rejects.toThrow('Invalid step');
      }
    });

    test('rejects empty string step', async () => {
      await expect(service.mark('org-123', '' as OnboardingStep)).rejects.toThrow('Invalid step');
    });
  });

  describe('ensure', () => {
    test('inserts onboarding row with ON CONFLICT DO NOTHING', async () => {
      pool._setResults([{ rows: [], rowCount: 1 }]);
      await service.ensure('org-123');
      const calls = pool._getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toContain('INSERT INTO org_onboarding');
      expect(calls[0]!.text).toContain('ON CONFLICT');
      expect(calls[0]!.values).toEqual(['org-123']);
    });

    test('rejects empty orgId', async () => {
      await expect(service.ensure('')).rejects.toThrow('Valid orgId is required');
    });

    test('rejects non-string orgId', async () => {
      await expect(service.ensure(null as any)).rejects.toThrow('Valid orgId is required');
      await expect(service.ensure(undefined as any)).rejects.toThrow('Valid orgId is required');
    });
  });

  describe('mark', () => {
    test('uses UPSERT to set step column to true', async () => {
      pool._setResults([{ rows: [], rowCount: 1 }]);
      const result = await service.mark('org-123', 'step_create_domain');
      expect(result).toBe(1);
      const calls = pool._getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toContain('INSERT INTO org_onboarding');
      expect(calls[0]!.text).toContain('ON CONFLICT');
      expect(calls[0]!.text).toContain('"step_create_domain"');
      expect(calls[0]!.text).toContain('updated_at');
      expect(calls[0]!.values).toEqual(['org-123']);
    });

    test('uses column map for each step', async () => {
      const steps: OnboardingStep[] = ['step_create_domain', 'step_create_content', 'step_publish_content'];
      for (const step of steps) {
        pool._reset();
        pool._setResults([{ rows: [], rowCount: 1 }]);
        await service.mark('org-123', step);
        const calls = pool._getCalls();
        expect(calls[0]!.text).toContain(`"${step}"`);
      }
    });

    test('returns 0 when no row affected', async () => {
      pool._setResults([{ rows: [], rowCount: 0 }]);
      const result = await service.mark('org-123', 'step_create_domain');
      expect(result).toBe(0);
    });

    test('handles null rowCount', async () => {
      pool._setResults([{ rows: [], rowCount: null as any }]);
      const result = await service.mark('org-123', 'step_create_domain');
      expect(result).toBe(0);
    });

    test('rejects empty orgId', async () => {
      await expect(service.mark('', 'step_create_domain')).rejects.toThrow('Valid orgId is required');
    });
  });

  describe('get', () => {
    test('returns onboarding state for existing org', async () => {
      const row = {
        org_id: 'org-123',
        step_create_domain: true,
        step_create_content: false,
        step_publish_content: false,
        completed: false,
      };
      pool._setResults(getSetupResults(row));
      const result = await service.get('org-123');
      expect(result?.['org_id']).toBe('org-123');
      expect(result?.['step_create_domain']).toBe(true);
      expect(result?.['step_create_content']).toBe(false);
      expect(result?.['step_publish_content']).toBe(false);
      expect(result?.completed).toBe(false);
    });

    test('returns null when row is missing after ensure', async () => {
      // SELECT returns nothing even after ensure
      pool._setResults([
        { rows: [], rowCount: 0 },   // BEGIN
        { rows: [], rowCount: 0 },   // SET TRANSACTION
        { rows: [], rowCount: 1 },   // _ensure
        { rows: [], rowCount: 0 },   // SELECT — empty
        { rows: [], rowCount: 0 },   // COMMIT
      ]);
      const result = await service.get('org-123');
      expect(result).toBeNull();
    });

    test('auto-completes and uses RETURNING when all steps are true', async () => {
      const row = {
        org_id: 'org-123',
        step_create_domain: true,
        step_create_content: true,
        step_publish_content: true,
        completed: false,
      };
      pool._setResults([
        { rows: [], rowCount: 0 },                   // BEGIN
        { rows: [], rowCount: 0 },                   // SET TRANSACTION
        { rows: [], rowCount: 1 },                   // _ensure
        { rows: [row], rowCount: 1 },                // SELECT
        { rows: [{ completed: true }], rowCount: 1 }, // UPDATE RETURNING completed
        { rows: [], rowCount: 0 },                   // COMMIT
      ]);
      const result = await service.get('org-123');
      expect(result?.completed).toBe(true);
      const calls = pool._getCalls();
      const updateCall = calls.find(c => c.text.includes('SET completed = true'));
      expect(updateCall).toBeDefined();
      expect(updateCall!.text).toContain('updated_at = now()');
      expect(updateCall!.text).toContain('AND completed = false');
      expect(updateCall!.text).toContain('RETURNING completed');
    });

    test('does not update when already completed', async () => {
      const row = {
        org_id: 'org-123',
        step_create_domain: true,
        step_create_content: true,
        step_publish_content: true,
        completed: true,
      };
      pool._setResults(getSetupResults(row));
      const result = await service.get('org-123');
      expect(result?.completed).toBe(true);
      const calls = pool._getCalls();
      // BEGIN, SET TXN, _ensure, SELECT, COMMIT — no UPDATE
      expect(calls.every(c => !c.text.includes('SET completed'))).toBe(true);
    });

    test('does not auto-complete when not all steps are done', async () => {
      const row = {
        org_id: 'org-123',
        step_create_domain: true,
        step_create_content: true,
        step_publish_content: false,
        completed: false,
      };
      pool._setResults(getSetupResults(row));
      const result = await service.get('org-123');
      expect(result?.completed).toBe(false);
      const calls = pool._getCalls();
      expect(calls.every(c => !c.text.includes('SET completed'))).toBe(true);
    });

    test('rejects empty orgId', async () => {
      await expect(service.get('')).rejects.toThrow('Valid orgId is required');
    });
  });

  describe('isCompleted', () => {
    test('returns true when completed', async () => {
      const row = {
        org_id: 'org-1',
        step_create_domain: true,
        step_create_content: true,
        step_publish_content: true,
        completed: true,
      };
      pool._setResults(getSetupResults(row));
      expect(await service.isCompleted('org-1')).toBe(true);
    });

    test('returns false when not completed', async () => {
      const row = {
        org_id: 'org-1',
        step_create_domain: false,
        step_create_content: false,
        step_publish_content: false,
        completed: false,
      };
      pool._setResults(getSetupResults(row));
      expect(await service.isCompleted('org-1')).toBe(false);
    });

    test('returns false when row is null', async () => {
      pool._setResults([
        { rows: [], rowCount: 0 },   // BEGIN
        { rows: [], rowCount: 0 },   // SET TRANSACTION
        { rows: [], rowCount: 1 },   // _ensure
        { rows: [], rowCount: 0 },   // SELECT — empty
        { rows: [], rowCount: 0 },   // COMMIT
      ]);
      expect(await service.isCompleted('org-1')).toBe(false);
    });
  });

  describe('getProgress', () => {
    test('returns 0 when no steps complete', async () => {
      const row = {
        org_id: 'org-1',
        step_create_domain: false,
        step_create_content: false,
        step_publish_content: false,
        completed: false,
      };
      pool._setResults(getSetupResults(row));
      expect(await service.getProgress('org-1')).toBe(0);
    });

    test('returns 33 when 1 of 3 steps complete', async () => {
      const row = {
        org_id: 'org-1',
        step_create_domain: true,
        step_create_content: false,
        step_publish_content: false,
        completed: false,
      };
      pool._setResults(getSetupResults(row));
      expect(await service.getProgress('org-1')).toBe(33);
    });

    test('returns 67 when 2 of 3 steps complete', async () => {
      const row = {
        org_id: 'org-1',
        step_create_domain: true,
        step_create_content: true,
        step_publish_content: false,
        completed: false,
      };
      pool._setResults(getSetupResults(row));
      expect(await service.getProgress('org-1')).toBe(67);
    });

    test('returns 100 when all steps complete (triggers auto-completion)', async () => {
      const row = {
        org_id: 'org-1',
        step_create_domain: true,
        step_create_content: true,
        step_publish_content: true,
        completed: false,
      };
      pool._setResults([
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 1 },
        { rows: [row], rowCount: 1 },
        { rows: [{ completed: true }], rowCount: 1 }, // UPDATE RETURNING
        { rows: [], rowCount: 0 },
      ]);
      expect(await service.getProgress('org-1')).toBe(100);
    });

    test('returns 0 when row is null', async () => {
      pool._setResults([
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 0 },
      ]);
      expect(await service.getProgress('org-1')).toBe(0);
    });
  });

  describe('reset', () => {
    test('resets all steps to false using correct column names', async () => {
      pool._setResults([{ rows: [], rowCount: 1 }]);
      await service.reset('org-123');
      const calls = pool._getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toContain('step_create_domain = false');
      expect(calls[0]!.text).toContain('step_create_content = false');
      expect(calls[0]!.text).toContain('step_publish_content = false');
      expect(calls[0]!.text).toContain('completed = false');
      expect(calls[0]!.text).toContain('updated_at = now()');
      expect(calls[0]!.values).toEqual(['org-123']);
    });

    test('rejects empty orgId', async () => {
      await expect(service.reset('')).rejects.toThrow('Valid orgId is required');
    });

    test('rejects non-string orgId', async () => {
      await expect(service.reset(123 as any)).rejects.toThrow('Valid orgId is required');
    });
  });
});
