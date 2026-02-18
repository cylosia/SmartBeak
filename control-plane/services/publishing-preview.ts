import { Pool } from 'pg';

import { NotFoundError } from '@errors';
import { renderFacebookPost } from '../../plugins/publishing-adapters/facebook/render';




/**
* Facebook preview result
*/
export interface FacebookPreviewResult {
  title: string;
  excerpt?: string;
  url: string;
  imageUrl?: string;
  rendered: string;
}

export class PublishingPreviewService {
  constructor(private pool: Pool) {}

  /**
  * Generate Facebook preview for content, verifying org ownership in the
  * same query that loads content data.
  *
  * P1-FIX: The previous implementation made two separate queries to
  * content_items — once in verifyContentOwnership (which threw a generic
  * `Error` causing the route to return HTTP 500) and again in facebookPreview.
  * This merged query:
  *   1. Returns NotFoundError (→ 404) with correct HTTP semantics when the
  *      content does not exist or belongs to a different org.
  *   2. Eliminates the redundant second round-trip to content_items, halving
  *      DB queries for this endpoint.
  *
  * @param contentId - Content ID
  * @param orgId - Organization ID
  * @returns Promise resolving to Facebook preview result
  */
  async facebookPreview(contentId: string, orgId: string): Promise<FacebookPreviewResult> {
  // Single query: load content AND verify org ownership atomically.
  // Joining through domains ensures the content belongs to the calling org.
  const content = await this.pool.query(
    `SELECT c.id, c.title
    FROM content_items c
    JOIN domains d ON c.domain_id = d.id
    WHERE c.id = $1 AND d.org_id = $2`,
    [contentId, orgId]
  );

  if (!content.rows[0]) {
    // 404 (not 403) to avoid disclosing whether the ID exists in another org.
    throw new NotFoundError('Content not found or access denied');
  }

  const seo = await this.pool.query(
    'SELECT description FROM seo_documents WHERE content_id=$1',
    [contentId]
  );

  // P0-FIX: Scope media_assets to this content to prevent cross-tenant image URL
  // leakage. Without a content_id filter every preview returned the most recently
  // uploaded asset from any organisation in the system.
  const media = await this.pool.query(
    "SELECT url FROM media_assets WHERE content_id = $1 AND status = 'uploaded' ORDER BY created_at DESC LIMIT 1",
    [contentId]
  );

  // P1-FIX: Replace hardcoded placeholder with configured app URL.
  // All preview URLs previously pointed to example.com instead of the
  // actual deployment domain, producing incorrect sharing links.
  const appBaseUrl = (process.env['APP_BASE_URL'] ?? '').replace(/\/$/, '');
  const contentUrl = `${appBaseUrl}/content/${contentId}`;

  const post = renderFacebookPost({
    title: content.rows[0].title,
    excerpt: seo.rows[0]?.description,
    url: contentUrl,
    imageUrl: media.rows[0]?.url
  });

  return {
    title: content.rows[0].title,
    excerpt: seo.rows[0]?.description,
    url: contentUrl,
    imageUrl: media.rows[0]?.url,
    rendered: post.message
  };
  }
}
