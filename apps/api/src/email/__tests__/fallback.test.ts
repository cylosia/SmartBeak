/**
 * P2 TEST: Email Provider Fallback Tests
 * 
 * Tests email provider failover chain, circuit breaker behavior,
 * and queueing of failed emails.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FallbackEmailSender,
  EmailProvider,
  EmailMessage,
  createLogProvider,
} from '../provider/fallback';

// Mock Redis
vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn().mockResolvedValue({
    lpush: vi.fn().mockResolvedValue(1),
  }),
}));

describe('Email Provider Fallback Tests', () => {
  let primaryProvider: EmailProvider;
  let secondaryProvider: EmailProvider;
  let tertiaryProvider: EmailProvider;
  let mockSenders: Map<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSenders = new Map();

    primaryProvider = createMockProvider('Primary', mockSenders);
    secondaryProvider = createMockProvider('Secondary', mockSenders);
    tertiaryProvider = createMockProvider('Tertiary', mockSenders);
  });

  const createMockProvider = (
    name: string,
    senders: Map<string, ReturnType<typeof vi.fn>>
  ): EmailProvider => {
    const sendFn = vi.fn();
    senders.set(name, sendFn);

    return {
      name,
      send: sendFn,
      healthCheck: vi.fn().mockResolvedValue(true),
    };
  };

  const createTestMessage = (): EmailMessage => ({
    to: 'test@example.com',
    from: 'sender@example.com',
    subject: 'Test Email',
    text: 'This is a test email',
    html: '<p>This is a test email</p>',
  });

  describe('Provider Failover Chain', () => {
    it('should send via primary provider when healthy', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider, secondaryProvider],
      });

      const sendFn = mockSenders.get('Primary')!;
      sendFn.mockResolvedValue({ id: 'primary-123', provider: 'Primary' });

      const result = await sender.send(createTestMessage());

      expect(result.provider).toBe('Primary');
      expect(result.attempts).toBe(1);
      expect(sendFn).toHaveBeenCalledTimes(1);
    });

    it('should failover to secondary when primary fails', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider, secondaryProvider],
      });

      const primarySend = mockSenders.get('Primary')!;
      const secondarySend = mockSenders.get('Secondary')!;

      primarySend.mockRejectedValue(new Error('Primary provider down'));
      secondarySend.mockResolvedValue({ id: 'secondary-123', provider: 'Secondary' });

      const result = await sender.send(createTestMessage());

      expect(result.provider).toBe('Secondary');
      expect(result.attempts).toBe(2);
      expect(primarySend).toHaveBeenCalledTimes(1);
      expect(secondarySend).toHaveBeenCalledTimes(1);
    });

    it('should failover through entire chain', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider, secondaryProvider, tertiaryProvider],
      });

      const primarySend = mockSenders.get('Primary')!;
      const secondarySend = mockSenders.get('Secondary')!;
      const tertiarySend = mockSenders.get('Tertiary')!;

      primarySend.mockRejectedValue(new Error('Primary down'));
      secondarySend.mockRejectedValue(new Error('Secondary down'));
      tertiarySend.mockResolvedValue({ id: 'tertiary-123', provider: 'Tertiary' });

      const result = await sender.send(createTestMessage());

      expect(result.provider).toBe('Tertiary');
      expect(result.attempts).toBe(3);
    });

    it('should throw when all providers fail', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider, secondaryProvider],
      });

      mockSenders.get('Primary')!.mockRejectedValue(new Error('Primary down'));
      mockSenders.get('Secondary')!.mockRejectedValue(new Error('Secondary down'));

      await expect(sender.send(createTestMessage())).rejects.toThrow(
        'All email providers failed'
      );
    });

    it('should queue failed emails for manual retry', async () => {
      const { getRedis } = await import('@kernel/redis');
      const mockRedis = {
        lpush: vi.fn().mockResolvedValue(1),
      };
      (getRedis as any).mockResolvedValue(mockRedis);

      const sender = new FallbackEmailSender({
        providers: [primaryProvider],
      });

      mockSenders.get('Primary')!.mockRejectedValue(new Error('Primary down'));

      try {
        await sender.send(createTestMessage());
      } catch {
        // Expected to throw
      }

      // P0-3 FIX: queueForRetry now masks PII before storing in Redis.
      // Verify raw email address is NOT present, and masked form IS present.
      expect(mockRedis.lpush).toHaveBeenCalledWith(
        'email:failed',
        expect.not.stringContaining('test@example.com')
      );
      expect(mockRedis.lpush).toHaveBeenCalledWith(
        'email:failed',
        expect.stringContaining('t***@e***.com')
      );
    });
  });

  describe('Circuit Breaker Behavior', () => {
    it('should open circuit after threshold failures', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider],
        failureThreshold: 3,
        resetTimeoutMs: 60000,
      });

      const primarySend = mockSenders.get('Primary')!;
      primarySend.mockRejectedValue(new Error('Persistent failure'));

      // Trigger 3 failures to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await sender.send(createTestMessage());
        } catch {
          // Expected
        }
      }

      // Circuit should be open, subsequent calls should fail fast
      primarySend.mockClear();
      await expect(sender.send(createTestMessage())).rejects.toThrow();
      
      // Should not call the provider when circuit is open
      expect(primarySend).not.toHaveBeenCalled();
    });

    it('should close circuit after reset timeout', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider],
        failureThreshold: 1,
        resetTimeoutMs: 10, // 10ms for testing
      });

      const primarySend = mockSenders.get('Primary')!;
      primarySend.mockRejectedValue(new Error('Failure'));

      // Open circuit
      try {
        await sender.send(createTestMessage());
      } catch {
        // Expected
      }

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 20));

      // Circuit should be half-open, try again
      primarySend.mockResolvedValueOnce({ id: 'recovery-123', provider: 'Primary' });
      
      const result = await sender.send(createTestMessage());
      expect(result.provider).toBe('Primary');
    });

    it('should track failures separately per provider', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider, secondaryProvider],
        failureThreshold: 2,
      });

      const primarySend = mockSenders.get('Primary')!;
      const secondarySend = mockSenders.get('Secondary')!;

      // Fail primary twice
      primarySend.mockRejectedValue(new Error('Primary failure'));
      for (let i = 0; i < 2; i++) {
        try {
          await sender.send(createTestMessage());
        } catch {
          // Will fail to secondary
        }
      }

      // Secondary should still work (its circuit not affected by primary failures)
      secondarySend.mockResolvedValue({ id: 'secondary-123', provider: 'Secondary' });
      
      const result = await sender.send(createTestMessage());
      expect(result.provider).toBe('Secondary');
    });
  });

  describe('Health Checks', () => {
    it('should report health status for all providers', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider, secondaryProvider],
      });

      const health = await sender.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.providers).toHaveLength(2);
      expect(health.providers[0]).toMatchObject({
        name: 'Primary',
        healthy: true,
        circuitOpen: false,
      });
    });

    it('should report unhealthy when all providers down', async () => {
      const unhealthyProvider1 = {
        name: 'Unhealthy1',
        send: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(false),
      };
      const unhealthyProvider2 = {
        name: 'Unhealthy2',
        send: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(false),
      };

      const sender = new FallbackEmailSender({
        providers: [unhealthyProvider1, unhealthyProvider2],
      });

      const health = await sender.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.providers.every(p => !p.healthy)).toBe(true);
    });

    it('should report circuit status in health check', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider],
        failureThreshold: 1,
      });

      // Open circuit
      mockSenders.get('Primary')!.mockRejectedValue(new Error('Failure'));
      try {
        await sender.send(createTestMessage());
      } catch {
        // Expected
      }

      const health = await sender.healthCheck();
      expect(health.providers[0]!.circuitOpen).toBe(true);
    });
  });

  describe('Email Message Handling', () => {
    it('should handle emails with attachments', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider],
      });

      const message: EmailMessage = {
        ...createTestMessage(),
        attachments: [
          {
            filename: 'test.pdf',
            content: Buffer.from('pdf content'),
            contentType: 'application/pdf',
          },
        ],
      };

      mockSenders.get('Primary')!.mockResolvedValue({
        id: 'attachment-123',
        provider: 'Primary',
      });

      const result = await sender.send(message);
      expect(result.provider).toBe('Primary');
    });

    it('should handle multiple recipients', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider],
      });

      const message: EmailMessage = {
        ...createTestMessage(),
        to: ['user1@example.com', 'user2@example.com'],
      };

      mockSenders.get('Primary')!.mockResolvedValue({
        id: 'multi-123',
        provider: 'Primary',
      });

      const result = await sender.send(message);
      expect(result.provider).toBe('Primary');
    });

    it('should preserve custom headers', async () => {
      const sender = new FallbackEmailSender({
        providers: [primaryProvider],
      });

      const message: EmailMessage = {
        ...createTestMessage(),
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Priority': '1',
        },
      };

      mockSenders.get('Primary')!.mockResolvedValue({
        id: 'headers-123',
        provider: 'Primary',
      });

      await sender.send(message);
      
      const sentMessage = mockSenders.get('Primary')!.mock.calls[0][0];
      expect(sentMessage.headers).toMatchObject({
        'X-Custom-Header': 'custom-value',
        'X-Priority': '1',
      });
    });
  });

  describe('Log Provider', () => {
    it('should create log provider as last resort', async () => {
      const logProvider = createLogProvider();

      expect(logProvider.name).toBe('Log');
      
      const result = await logProvider.send(createTestMessage());
      expect(result.id).toMatch(/^log-/);
      expect(result.provider).toBe('Log');
    });

    it('should always report healthy for log provider', async () => {
      const logProvider = createLogProvider();
      
      const isHealthy = await logProvider.healthCheck();
      expect(isHealthy).toBe(true);
    });
  });
});
