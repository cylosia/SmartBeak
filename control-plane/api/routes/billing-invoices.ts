import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { billingConfig } from '@config/billing';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';

const logger = getLogger('billing-invoices');

// P1-FIX: Initialize Stripe eagerly at module load, not lazily per-request.
// The previous lazy-singleton used a non-atomic check-then-assign that allowed
// concurrent requests to each create their own Stripe instance, leaking HTTP
// agents and file descriptors under load. Eager init also surfaces missing
// credentials immediately at startup instead of on the first billing request.
import Stripe from 'stripe';
const stripe = new Stripe(billingConfig.stripeSecretKey, {
  apiVersion: '2023-10-16',
});

export async function billingInvoiceRoutes(app: FastifyInstance, pool: Pool) {
  // GET /billing/invoices - List invoices for the organization
  app.get('/billing/invoices', async (req, res) => {
  // SECURITY FIX: Rate limit BEFORE auth to prevent DoS
  await rateLimit('billing:invoices', 50, req, res);
  const ctx = getAuthContext(req);
  // M3-FIX: Restrict invoice access to owner/admin only (was allowing viewers to see financial data)
  requireRole(ctx, ['owner', 'admin']);

  try {
    // Fetch the organization's Stripe customer ID
    const { rows: orgRows } = await pool.query(
    'SELECT stripe_customer_id FROM organizations WHERE id = $1',
    [ctx["orgId"]]
    );

    const stripeCustomerId = orgRows[0]?.stripe_customer_id;

    // If no Stripe customer ID, return empty array
    if (!stripeCustomerId) {
    return { invoices: [] };
    }

    const invoices = await stripe.invoices.list({
    customer: stripeCustomerId,
    limit: 50,
    status: 'paid'
    });

    // Transform to frontend-friendly format with camelCase
    const formattedInvoices = invoices.data.map(inv => ({
    id: inv["id"],
    number: inv.number,
    amountPaid: inv.amount_paid,
    amountDue: inv.amount_due,
    currency: inv.currency,
    status: inv.status,
    hostedInvoiceUrl: inv.hosted_invoice_url,
    invoicePdf: inv.invoice_pdf,
    // M5-FIX: Convert Stripe Unix timestamps (seconds) to ISO strings for frontend display
    createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : null,
    dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
    description: inv.description,
    periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
    periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
    }));

    return { invoices: formattedInvoices };
  } catch (error) {
    // P2-FIX: Removed silent swallow of 'Stripe'-message errors. Any error whose
    // message contained "Stripe" was returned as an empty invoice list with no
    // logging — hiding API key rotations, timeouts, and config failures in prod.
    logger.error('Error fetching invoices', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to fetch invoices');
  }
  });

  // P2-FIX: Removed duplicate GET /billing/invoices/export registration.
  // The canonical implementation lives in billingInvoiceExport.ts and is
  // registered there with its own dedicated plugin. Having two registrations
  // caused the second one loaded to shadow the first, producing unpredictable
  // routing behaviour depending on plugin load order.
}
