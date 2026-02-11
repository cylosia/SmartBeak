
import { assertSecretPresent } from './services/secrets';

export async function runStartupChecks(): Promise<void> {
  await assertSecretPresent('JWT_SECRET');
  await assertSecretPresent('CONTROL_PLANE_DB');
}
