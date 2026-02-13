
import { abuseGuard } from '../src/middleware/abuseGuard';
test('abuse guard blocks prohibited without override', async () => {
  const req: any = { body: { riskFlags: ['prohibited'] } };
  await expect(
  new Promise((resolve, reject) => {
    void abuseGuard(req, {}, (err: any) => (err ? reject(err) : resolve(null)));
  })
  ).rejects.toThrow();
});
