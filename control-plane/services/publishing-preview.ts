import { Pool } from 'pg';

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

  async verifyContentOwnership(contentId: string, orgId: string): Promise<void> {
  const result = await this.pool.query(
    `SELECT c.id
    FROM content_items c
    JOIN domains d ON c.domain_id = d.id
    WHERE c.id = $1 AND d.org_id = $2`,
    [contentId, orgId]
  );

  if (result.rows.length === 0) {
    throw new Error('Content not found or access denied');
  }
  }

  /**
  * Generate Facebook preview for content
  * @param contentId - Content ID
  * @param orgId - Organization ID
  * @returns Promise resolving to Facebook preview result
  */
  async facebookPreview(contentId: string, orgId: string): Promise<FacebookPreviewResult> {
  await this.verifyContentOwnership(contentId, orgId);

  // Load minimal fields; pure read-only projection
  const content = await this.pool.query(
    'SELECT id, title FROM content_items WHERE id=$1',
    [contentId]
  );

  if (!content.rows[0]) {
    throw new Error('Content not found');
  }

  const seo = await this.pool.query(
    'SELECT description FROM seo_documents WHERE content_id=$1',
    [contentId]
  );

  const media = await this.pool.query(
    'SELECT url FROM media_assets WHERE status=\'uploaded\' ORDER BY created_at DESC LIMIT 1'
  );

  const post = renderFacebookPost({
    title: content.rows[0].title,
    excerpt: seo.rows[0]?.description,
    url: `https://example.com/content/${contentId}`,
    imageUrl: media.rows[0]?.url
  });

  return {
    title: content.rows[0].title,
    excerpt: seo.rows[0]?.description,
    url: `https://example.com/content/${contentId}`,
    imageUrl: media.rows[0]?.url,
    rendered: post.message
  };
  }
}
