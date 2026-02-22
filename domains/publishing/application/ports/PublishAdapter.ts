/**
 * Publishing adapter port — re-exports canonical types from packages/types/publishing.
 *
 * The canonical definitions live in packages/types/publishing.ts which also contains
 * PublishJobPayload, retry/auth/rate-limit config types, and isPublishTargetConfig().
 * This file exists to preserve the DDD port location for domain-layer consumers.
 */
export type {
  PublishTargetConfig,
  PublishInput,
  PublishAdapter,
} from '../../../../packages/types/publishing';

export { validateTargetConfig } from '../../../../packages/types/publishing';
