
import { NotImplementedError } from '../../errors';
export async function ingestInstagramAnalytics(_mediaId: string): Promise<never> {
  throw new NotImplementedError('Instagram analytics not yet implemented');
}
