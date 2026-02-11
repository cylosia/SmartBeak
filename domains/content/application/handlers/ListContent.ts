
import { ContentRepository } from '../ports/ContentRepository';
import { ContentStatus } from '../../domain/entities/ContentItem';

export class ListContent {
  constructor(private repo: ContentRepository) {}

  async byStatus(
  status: ContentStatus,
  limit = 20,
  offset = 0,
  domainId?: string
  ): Promise<ReturnType<ContentRepository['listByStatus']>> {
  return this.repo.listByStatus(status, limit, offset, domainId);
  }

  async byDomain(
  domainId: string,
  limit = 50,
  offset = 0
  ): Promise<ReturnType<ContentRepository['listByDomain']>> {
  return this.repo.listByDomain(domainId, limit, offset);
  }
}
