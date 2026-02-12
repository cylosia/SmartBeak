import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';

import { getLogger } from '../../../packages/kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, type AuthContext } from '../../services/auth';

const logger = getLogger('Themes');

﻿


/**
* Authenticated request interface
*/
export type AuthenticatedRequest = FastifyRequest & {
  auth?: {
  userId: string;
  orgId: string;
  role: string;
  } | null | undefined;
};

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
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx as AuthContext, ['owner', 'admin', 'editor', 'viewer']);
    await rateLimit('themes', 100);
    // Fetch themes from database or use configuration
    let themes = [];
    try {
    const result = await pool.query(
    `SELECT id, name, description, preview_url as preview, colors, is_default, is_active
    FROM themes
    WHERE is_active = true
    ORDER BY is_default DESC, name`
    );
    themes = result.rows.map(row => ({
    id: row["id"],
    name: row.name,
    description: row.description,
    preview: row.preview,
    colors: row.colors || {
    primary: '#007bff',
    secondary: '#6c757d',
    background: '#ffffff',
    },
    isDefault: row.is_default,
    }));
    } catch (dbError) {
    logger.warn(`[themes] Database error, using defaults: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
    // Fallback to configurable defaults if DB unavailable
    themes = getDefaultThemes();
    }

    // If no themes in DB, use defaults
    if (themes.length === 0) {
    themes = getDefaultThemes();
    }

    return { themes };
  } catch (error) {
    logger.error('[themes] Error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).send({ error: 'Failed to fetch themes' });
  }
  });
}
