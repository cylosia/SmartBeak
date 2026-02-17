
// Stub adapter for testing purposes
import { PublishingAdapter, PublishingContent, PublishingTarget } from '../src/domain/publishing/PublishingAdapter';
class TestPublishingAdapter implements PublishingAdapter {
  readonly targetType = 'test';

  validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config || Object.keys(config).length === 0) {
    errors.push('Config is required');
  }
  return { valid: errors.length === 0, errors };
  }

  async publish(content: PublishingContent, target: PublishingTarget): Promise<{ success: boolean; publishedUrl?: string; publishedId?: string; error?: string; timestamp: Date }> {
  if (!target.config || Object.keys(target.config).length === 0) {
    throw new Error('Target config is required');
  }
  return { success: true, timestamp: new Date() };
  }
}

test('publishing requires path', async () => {
  const adapter = new TestPublishingAdapter();
  const content: PublishingContent = { title: 'Test', body: 'Test body' };
  const target: PublishingTarget = { id: '1', type: 'test', name: 'Test', config: {} };
  await expect(adapter.publish(content, target))
  .rejects.toThrow();
});
