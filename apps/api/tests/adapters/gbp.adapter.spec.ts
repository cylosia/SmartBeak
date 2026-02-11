
import { GbpAdapter } from '../../src/adapters/gbp/GbpAdapter';

test('GBP adapter creates a post', async () => {
  const adapter = new GbpAdapter({ clientId: 'test', clientSecret: 'test' });
  const res = await adapter.createPost('location123', { summary: 'Test', languageCode: 'en-US' });

  expect(res.state).toBeDefined();
});
