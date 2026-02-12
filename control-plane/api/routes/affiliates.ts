

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { generateETag, setCacheHeaders } from '../middleware/cache';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export async function affiliateRoutes(app: FastifyInstance, _pool: Pool) {
  // GET /affiliates/offers - List available affiliate offers
  app.get('/affiliates/offers', async (req, res) => {
  // SECURITY FIX: Rate limit BEFORE auth to prevent DoS
  await rateLimit('affiliates', 50);
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

  const queryResult = QuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).send({
    error: 'Invalid pagination parameters',
    code: 'VALIDATION_ERROR',
    });
  }

  const { page, limit } = queryResult.data;
  const offset = (page - 1) * limit;

  try {
    // In production, fetch from affiliate APIs (Amazon, CJ, Impact)
    // For now, return placeholder data with frontend-compatible property names
    const allOffers = [
    {
    id: 'amz-001',
    merchantName: 'Amazon',
    status: 'active',
    riskNotes: 'Low risk, stable commission rates',
    category: 'Electronics',
    commission: 4.0,
    price: 99.99,
    },
    {
    id: 'cj-001',
    merchantName: 'TechPartner Inc',
    status: 'active',
    riskNotes: 'Medium risk, quarterly commission reviews',
    category: 'Software',
    commission: 15.0,
    price: 49.99,
    },
    ];

    // Apply pagination
    const offers = allOffers.slice(offset, offset + limit);
    const total = allOffers.length;

    const result = {
    offers,
    pagination: {
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    perPage: limit,
    }
    };

    const etag = generateETag(result);
    setCacheHeaders(res, { etag, maxAge: 300, private: true });

    return result;
  } catch (error) {
    console["error"]('[affiliates/offers] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({
    error: 'Failed to fetch affiliate offers',
    code: 'INTERNAL_ERROR',
    });
  }
  });
}
