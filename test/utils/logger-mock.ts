/**
 * Mock Logger Utilities for Testing
 * 
 * Provides utilities for capturing and asserting on log output in tests.
 * 
 * Usage:
 * ```typescript
 * import { MockLogger, setupMockLogger } from '@test/utils/logger-mock';
 * 
 * describe('MyService', () => {
 *   const mockLogger = setupMockLogger();
 *   
 *   it('should log correctly', () => {
 *     // Run your code that logs
 *     
 *     // Assert on logs
 *     expect(mockLogger.hasLog('info', /Processing/)).toBe(true);
 *     expect(mockLogger.getErrors()).toHaveLength(0);
 *   });
 * });
 * ```
 */

import { LogEntry, LogHandler, LogLevel, addLogHandler } from '../../packages/kernel/logger';

/**
 * Mock logger that captures log entries for testing
 */
export class MockLogger {
  private entries: LogEntry[] = [];
  private cleanup: (() => void) | null = null;

  /**
   * Start capturing log entries
   */
  startCapturing(): void {
    const handler: LogHandler = (entry) => {
      this.entries.push(entry);
    };
    this.cleanup = addLogHandler(handler);
  }

  /**
   * Stop capturing log entries
   */
  stopCapturing(): void {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  }

  /**
   * Get all captured log entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all captured entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Check if a log entry exists matching criteria
   */
  hasLog(level: LogLevel, messagePattern: RegExp | string): boolean {
    const pattern = typeof messagePattern === 'string' 
      ? new RegExp(messagePattern) 
      : messagePattern;
    
    return this.entries.some(
      e => e.level === level && pattern.test(e.message)
    );
  }

  /**
   * Get all log entries at a specific level
   */
  getByLevel(level: LogLevel): LogEntry[] {
    return this.entries.filter(e => e.level === level);
  }

  /**
   * Get all error and fatal log entries
   */
  getErrors(): LogEntry[] {
    return this.entries.filter(e => e.level === 'error' || e.level === 'fatal');
  }

  /**
   * Get all warning log entries
   */
  getWarnings(): LogEntry[] {
    return this.entries.filter(e => e.level === 'warn');
  }

  /**
   * Check if any errors were logged
   */
  hasErrors(): boolean {
    return this.getErrors().length > 0;
  }

  /**
   * Get log entries for a specific service
   */
  getByService(service: string): LogEntry[] {
    return this.entries.filter(e => e.service === service);
  }

  /**
   * Get log entries with specific metadata key
   */
  getByMetadataKey(key: string): LogEntry[] {
    return this.entries.filter(e => e.metadata && key in e.metadata);
  }

  /**
   * Assert that a log was called with specific criteria
   * Throws if not found
   */
  assertLog(
    level: LogLevel, 
    messagePattern: RegExp | string,
    metadataCheck?: (metadata: Record<string, unknown> | undefined) => boolean
  ): void {
    const pattern = typeof messagePattern === 'string' 
      ? new RegExp(messagePattern) 
      : messagePattern;
    
    const found = this.entries.some(e => {
      if (e.level !== level) return false;
      if (!pattern.test(e.message)) return false;
      if (metadataCheck && !metadataCheck(e.metadata)) return false;
      return true;
    });

    if (!found) {
      const entriesStr = this.entries
        .map(e => `[${e.level}] ${e.message}`)
        .join('\n  ');
      throw new Error(
        `Expected log not found: [${level}] ${messagePattern}\n` +
        `Captured logs:\n  ${entriesStr || '(none)'}`
      );
    }
  }

  /**
   * Assert that no errors were logged
   */
  assertNoErrors(): void {
    const errors = this.getErrors();
    if (errors.length > 0) {
      const errorStr = errors
        .map(e => `[${e.level}] ${e.message}: ${e.errorMessage || ''}`)
        .join('\n  ');
      throw new Error(`Unexpected errors logged:\n  ${errorStr}`);
    }
  }

  /**
   * Print all captured logs (for debugging)
   */
  printLogs(): void {
    console.log('Captured logs:');
    this.entries.forEach(e => {
      console.log(`  [${e.level}] ${e.message}`, e.metadata || '');
    });
  }
}

/**
 * Jest helper that sets up mock logger with beforeEach/afterEach
 * 
 * Usage:
 * ```typescript
 * describe('MyService', () => {
 *   const mockLogger = setupMockLogger();
 *   
 *   it('should work', () => {
 *     // test code
 *     mockLogger.assertNoErrors();
 *   });
 * });
 * ```
 */
export function setupMockLogger(): MockLogger {
  const mock = new MockLogger();
  
  beforeEach(() => {
    mock.clear();
    mock.startCapturing();
  });
  
  afterEach(() => {
    mock.stopCapturing();
  });
  
  return mock;
}

/**
 * Create a spy logger that captures logs without modifying handlers
 * Useful for isolated tests
 */
export function createSpyLogger(): {
  getEntries: () => LogEntry[];
  clear: () => void;
  spy: LogHandler;
} {
  const entries: LogEntry[] = [];
  
  const spy: LogHandler = (entry) => {
    entries.push(entry);
  };
  
  return {
    getEntries: () => [...entries],
    clear: () => { entries.length = 0; },
    spy,
  };
}

export default {
  MockLogger,
  setupMockLogger,
  createSpyLogger,
};
