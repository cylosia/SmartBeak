
import { ContentRepository } from '../ports/ContentRepository';
import { ContentStatus } from '../../domain/entities/ContentItem';

// P2-FIX: Clamp limit and offset to prevent resource exhaustion
const MAX_LIMIT = 100;
const MAX_OFFSET = 10000;

export class ListContent {
  constructor(private repo: ContentRepository) {}

  async byStatus(
  status: ContentStatus,
  limit = 20,
  offset = 0,
  orgId?: string,
  domainId?: string
  ): Promise<ReturnType<ContentRepository['listByStatus']>> {
  // P0-4 FIX: orgId parameter added for multi-tenant isolation.
  // Callers MUST pass orgId to scope results to the authenticated tenant.
  return this.repo.listByStatus(
    status,
    Math.min(Math.max(1, limit), MAX_LIMIT),
    Math.min(Math.max(0, offset), MAX_OFFSET),
    domainId,
    orgId
  );
  }

  async byDomain(
  domainId: string,
  limit = 50,
  offset = 0
  ): Promise<ReturnType<ContentRepository['listByDomain']>> {
  return this.repo.listByDomain(
    domainId,
    Math.min(Math.max(1, limit), MAX_LIMIT),
    Math.min(Math.max(0, offset), MAX_OFFSET)
  );
  }
}
