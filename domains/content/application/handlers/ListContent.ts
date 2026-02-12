
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
  domainId?: string
  ): Promise<ReturnType<ContentRepository['listByStatus']>> {
  return this.repo.listByStatus(
    status,
    Math.min(Math.max(1, limit), MAX_LIMIT),
    Math.min(Math.max(0, offset), MAX_OFFSET),
    domainId
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
