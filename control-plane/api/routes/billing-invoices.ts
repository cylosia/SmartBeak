import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { billingConfig } from '@config/billing';
import { getLogger } from '@kernel/logger';

const logger = getLogger('billing-invoices');

const FormatQuerySchema = z.object({
  format: z.enum(['csv', 'pdf']).default('csv')
});

export async function billingInvoiceRoutes(app: FastifyInstance, pool: Pool) {
  // GET /billing/invoices - List invoices for the organization
  app.get('/billing/invoices', async (req, res) => {
  // SECURITY FIX: Rate limit BEFORE auth to prevent DoS
  await rateLimit('billing:invoices', 50);
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

    // Import Stripe dynamically
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(billingConfig.stripeSecretKey, {
    apiVersion: '2024-06-20' as Stripe.LatestApiVersion
    });

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
    logger.error('Error fetching invoices', error instanceof Error ? error : new Error(String(error)));

    // Return empty array if Stripe is not configured
    if (error instanceof Error && error.message.includes('Stripe')) {
    return { invoices: [] };
    }

    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch invoices' });
  }
  });

  // GET /billing/invoices/export - Export invoices (CSV/PDF)
  app.get('/billing/invoices/export', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);
  await rateLimit('billing:invoices:export', 20);

  try {
    const { format } = FormatQuerySchema.parse(req.query);

    // Fetch invoices
    const { rows: orgRows } = await pool.query(
    'SELECT stripe_customer_id FROM organizations WHERE id = $1',
    [ctx["orgId"]]
    );

    const stripeCustomerId = orgRows[0]?.stripe_customer_id;

    if (!stripeCustomerId) {
    return res.status(404).send({ error: 'No billing data found' });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(billingConfig.stripeSecretKey, {
    apiVersion: '2024-06-20' as Stripe.LatestApiVersion
    });

    const invoices = await stripe.invoices.list({
    customer: stripeCustomerId,
    limit: 100
    });

    if (format === 'csv') {
    // Generate CSV with injection protection
    const csvHeader = 'Invoice Number,Date,Amount,Currency,Status,Description\n';
    const csvRows = invoices.data.map(inv => {
    // SECURITY FIX: Sanitize fields to prevent CSV injection
    const sanitize = (field: string | null | undefined): string => {
    if (!field) return '';
    // Escape quotes and wrap in quotes
    let sanitized = field.replace(/"/g, '""');
    // SECURITY: Prefix formulas to prevent injection
    if (/^[=+\-@\t\r|]/.test(sanitized)) {
        sanitized = "'" + sanitized;
    }
    return `"${sanitized}"`;
    };

    return [
    sanitize(inv.number),
    sanitize(new Date(inv.created * 1000).toISOString()),
    sanitize(String(inv.amount_paid / 100)),
    sanitize(inv.currency),
    sanitize(inv.status),
    sanitize(inv.description),
    ].join(',');
    }).join('\n');

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', "attachment; filename='invoices.csv'");
    return res.type('text/csv').send(csvHeader + csvRows);
    }

    return res.status(400).send({ error: 'Unsupported format. Use csv.' });
  } catch (error) {
    logger.error('Error exporting invoices', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to export invoices' });
  }
  });
}
