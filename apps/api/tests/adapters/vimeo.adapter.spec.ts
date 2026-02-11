
import { VimeoAdapter } from '../../src/adapters/vimeo/VimeoAdapter';

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;

test('Vimeo metadata update succeeds', async () => {
  const adapter = new VimeoAdapter('token');
  await adapter.updateMetadata('vid', { name: 'Test' });
});
