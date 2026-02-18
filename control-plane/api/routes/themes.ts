import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { getAuthContext } from '../types';
import { errors } from '@errors/responses';

const logger = getLogger('Themes');

/**
* Get default themes as fallback
*/
function getDefaultThemes() {
  return [
    {
      id: 'default',
      name: 'Default',
      description: 'Clean, minimalist design',
      preview: '/themes/default/preview.png',
      colors: {
        primary: '#007bff',
        secondary: '#6c757d',
        background: '#ffffff',
      },
      isDefault: true,
    },
    {
      id: 'modern',
      name: 'Modern',
      description: 'Bold, contemporary design',
      preview: '/themes/modern/preview.png',
      colors: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
        background: '#fafafa',
      },
      isDefault: false,
    },
    {
      id: 'classic',
      name: 'Classic',
      description: 'Traditional, elegant design',
      preview: '/themes/classic/preview.png',
      colors: {
        primary: '#2c3e50',
        secondary: '#95a5a6',
        background: '#ecf0f1',
      },
      isDefault: false,
    },
  ];
}

export async function themeRoutes(app: FastifyInstance, pool: Pool) {
  // GET /themes - List available themes
  app.get('/themes', async (req, res) => {
    // FIXED (THEMES-7): Auth and rate-limit calls moved OUTSIDE the outer try/catch.
    // When these were inside try/catch, AuthError (→ 401) and RateLimitError (→ 429)
    // were swallowed by the catch block and returned as 500 Internal Server Error.
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    await rateLimit(`themes:${ctx.orgId}`, 100);

    // Fetch themes from database or use configuration
    let themes = [];
    let degraded = false;
    try {
      const result = await pool.query(
        `SELECT id, name, description, preview_url as preview, colors, is_default, is_active
         FROM themes
         WHERE is_active = true
         ORDER BY is_default DESC, name`
      );
      // FIXED (THEMES-7): Use bracket notation for all row property access
      // (noPropertyAccessFromIndexSignature requires bracket notation on index-typed objects).
      themes = result.rows.map(row => ({
        id: row['id'],
        name: row['name'],
        description: row['description'],
        preview: row['preview'],
        colors: row['colors'] || {
          primary: '#007bff',
          secondary: '#6c757d',
          background: '#ffffff',
        },
        isDefault: row['is_default'],
      }));
    } catch (dbError) {
      logger.error('[themes] Database unavailable, using defaults', dbError instanceof Error ? dbError : new Error(String(dbError)));
      themes = getDefaultThemes();
      degraded = true;
    }

    // If no themes in DB, use defaults
    if (themes.length === 0) {
      themes = getDefaultThemes();
    }

    return { themes, ...(degraded && { degraded: true }) };
  });
}
