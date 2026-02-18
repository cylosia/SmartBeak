
import { OnboardingService, OnboardingStep } from './onboarding';

// Mock pg Pool
function createMockPool() {
  const queryResults: Array<{ rows: unknown[]; rowCount: number }> = [];
  const queryCalls: Array<{ text: string; values: unknown[] }> = [];

  const pool = {
    query: jest.fn(async (text: string, values?: unknown[]) => {
      queryCalls.push({ text, values: values ?? [] });
      return queryResults.shift() ?? { rows: [], rowCount: 0 };
    }),
    // FIX (test-update for ON-1): get() now uses pool.connect() + a client so that
    // ensure + SELECT + conditional UPDATE run inside a single transaction.
    // The mock client shares the same result queue as pool.query so existing test
    // setups that enqueue results via pool._setResults() continue to work.
    //
    // BEGIN / COMMIT / ROLLBACK are intercepted and treated as no-ops (they do NOT
    // consume from the result queue and are NOT recorded in queryCalls).  This
    // preserves all existing assertions on call counts and indices.
    connect: jest.fn(async () => {
      const client = {
        query: jest.fn(async (text: string, values?: unknown[]) => {
          const trimmed = (text as string).trim().toUpperCase();
          // Intercept transaction control and session-configuration statements as
          // no-ops so they do NOT consume from the result queue and are NOT
          // recorded in queryCalls.  The list covers:
          //   • BEGIN variants (plain BEGIN, BEGIN ISOLATION LEVEL ...)
          //   • COMMIT and ROLLBACK
          //   • SET LOCAL ... (statement_timeout, lock_timeout, etc.)
          if (
            trimmed === 'BEGIN' ||
            trimmed.startsWith('BEGIN ') ||
            trimmed === 'COMMIT' ||
            trimmed === 'ROLLBACK' ||
            trimmed.startsWith('SET LOCAL ')
          ) {
            return { rows: [], rowCount: 0 };
          }
          // Route through the shared result queue + call tracker
          queryCalls.push({ text, values: values ?? [] });
          return queryResults.shift() ?? { rows: [], rowCount: 0 };
        }),
        release: jest.fn(),
      };
      return client;
    }),
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
    test('accepts valid steps: profile, billing, team', async () => {
      const validSteps: OnboardingStep[] = ['profile', 'billing', 'team'];
      for (const step of validSteps) {
        pool._reset();
        pool._setResults([{ rows: [], rowCount: 1 }]);
        await expect(service.mark('org-123', step)).resolves.not.toThrow();
      }
    });

    test('rejects invalid step names', async () => {
      await expect(service.mark('org-123', 'invalid' as OnboardingStep)).rejects.toThrow('Invalid step');
    });

    test('rejects SQL injection attempts via step parameter', async () => {
      const injectionAttempts = [
        "profile; DROP TABLE org_onboarding--",
        "profile = true, admin",
        "' OR '1'='1",
        "profile\"; DELETE FROM org_onboarding; --",
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
      const result = await service.mark('org-123', 'profile');
      expect(result).toBe(1);
      const calls = pool._getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toContain('INSERT INTO org_onboarding');
      expect(calls[0]!.text).toContain('ON CONFLICT');
      expect(calls[0]!.text).toContain('"profile"');
      expect(calls[0]!.text).toContain('updated_at');
      expect(calls[0]!.values).toEqual(['org-123']);
    });

    test('uses column map for each step', async () => {
      const steps: OnboardingStep[] = ['profile', 'billing', 'team'];
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
      const result = await service.mark('org-123', 'profile');
      expect(result).toBe(0);
    });

    test('handles null rowCount', async () => {
      pool._setResults([{ rows: [], rowCount: null as any }]);
      const result = await service.mark('org-123', 'profile');
      expect(result).toBe(0);
    });

    test('rejects empty orgId', async () => {
      await expect(service.mark('', 'profile')).rejects.toThrow('Valid orgId is required');
    });
  });

  describe('get', () => {
    // Note: get() runs inside a transaction (pool.connect → BEGIN/INSERT/SELECT/[UPDATE]/COMMIT).
    // BEGIN, COMMIT, ROLLBACK are intercepted by the mock and do not consume result queue entries.
    // Calls tracked in pool._getCalls() are: INSERT (ensure), SELECT, [UPDATE if auto-complete].

    test('returns onboarding state for existing org', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 }, // INSERT (ensure)
        { rows: [{ org_id: 'org-123', profile: true, billing: false, team: false, completed: false }], rowCount: 1 },
      ]);
      const result = await service.get('org-123');
      expect(result).toEqual({
        org_id: 'org-123',
        profile: true,
        billing: false,
        team: false,
        completed: false,
      });
    });

    test('returns null when row is missing (H06 fix)', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 }, // INSERT (ensure)
        { rows: [], rowCount: 0 }, // SELECT returns nothing
      ]);
      const result = await service.get('org-123');
      expect(result).toBeNull();
    });

    test('auto-completes when all steps are true', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 }, // INSERT (ensure)
        { rows: [{ org_id: 'org-123', profile: true, billing: true, team: true, completed: false }], rowCount: 1 },
        { rows: [], rowCount: 1 }, // UPDATE completed=true
      ]);
      const result = await service.get('org-123');
      expect(result?.completed).toBe(true);
      const calls = pool._getCalls();
      const updateCall = calls[2];
      expect(updateCall!.text).toContain('SET completed=true');
      expect(updateCall!.text).toContain('updated_at=now()');
      expect(updateCall!.text).toContain('AND completed=false');
    });

    test('does not update when already completed', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 }, // INSERT (ensure)
        { rows: [{ org_id: 'org-123', profile: true, billing: true, team: true, completed: true }], rowCount: 1 },
      ]);
      const result = await service.get('org-123');
      expect(result?.completed).toBe(true);
      const calls = pool._getCalls();
      // Should only have 2 tracked calls (ensure + select), no update
      expect(calls).toHaveLength(2);
    });

    test('does not auto-complete when not all steps are done', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 }, // INSERT (ensure)
        { rows: [{ org_id: 'org-123', profile: true, billing: true, team: false, completed: false }], rowCount: 1 },
      ]);
      const result = await service.get('org-123');
      expect(result?.completed).toBe(false);
      expect(pool._getCalls()).toHaveLength(2); // no update
    });

    test('rejects empty orgId', async () => {
      await expect(service.get('')).rejects.toThrow('Valid orgId is required');
    });
  });

  describe('isCompleted', () => {
    test('returns true when completed', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 },
        { rows: [{ org_id: 'org-1', profile: true, billing: true, team: true, completed: true }], rowCount: 1 },
      ]);
      expect(await service.isCompleted('org-1')).toBe(true);
    });

    test('returns false when not completed', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 },
        { rows: [{ org_id: 'org-1', profile: false, billing: false, team: false, completed: false }], rowCount: 1 },
      ]);
      expect(await service.isCompleted('org-1')).toBe(false);
    });

    test('returns false when row is null', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 0 },
      ]);
      expect(await service.isCompleted('org-1')).toBe(false);
    });
  });

  describe('getProgress', () => {
    test('returns 0 when no steps complete', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 },
        { rows: [{ org_id: 'org-1', profile: false, billing: false, team: false, completed: false }], rowCount: 1 },
      ]);
      expect(await service.getProgress('org-1')).toBe(0);
    });

    test('returns 33 when 1 of 3 steps complete', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 },
        { rows: [{ org_id: 'org-1', profile: true, billing: false, team: false, completed: false }], rowCount: 1 },
      ]);
      expect(await service.getProgress('org-1')).toBe(33);
    });

    test('returns 67 when 2 of 3 steps complete', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 },
        { rows: [{ org_id: 'org-1', profile: true, billing: true, team: false, completed: false }], rowCount: 1 },
      ]);
      expect(await service.getProgress('org-1')).toBe(67);
    });

    test('returns 100 when all steps complete', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 },
        { rows: [{ org_id: 'org-1', profile: true, billing: true, team: true, completed: false }], rowCount: 1 },
        { rows: [], rowCount: 1 }, // auto-complete UPDATE
      ]);
      expect(await service.getProgress('org-1')).toBe(100);
    });

    test('returns 0 when row is null', async () => {
      pool._setResults([
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 0 },
      ]);
      expect(await service.getProgress('org-1')).toBe(0);
    });
  });

  describe('reset', () => {
    test('resets all steps to false', async () => {
      pool._setResults([{ rows: [], rowCount: 1 }]);
      await service.reset('org-123');
      const calls = pool._getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toContain('profile = false');
      expect(calls[0]!.text).toContain('billing = false');
      expect(calls[0]!.text).toContain('team = false');
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
