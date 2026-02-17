
import { LinkedInAdapter } from '../../src/adapters/linkedin/LinkedInAdapter';

test('LinkedIn adapter creates company post', async () => {
  const adapter = new LinkedInAdapter('token');
  const res = await adapter.createCompanyPost('org123', { text: 'Hello' }) as { status: string; id: string };

  expect(res.status).toBe('created');
});
