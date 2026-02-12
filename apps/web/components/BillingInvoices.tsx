import React from 'react';

import { useInvoices } from '../hooks';
import { EmptyState } from './EmptyState';
import { Loading } from './Loading';

/**
 * Billing Invoices Component
 * Displays list of paid invoices using React Query
 */

export function BillingInvoices() {
  const { data: invoices, isLoading, error } = useInvoices();

  if (isLoading) {
  return <Loading />;
  }

  if (error) {
  return (
    <EmptyState
    title={`Error loading invoices: ${error.message}`}
    />
  );
  }

  if (!invoices || invoices.length === 0) {
  return <EmptyState title='No invoices found' />;
  }

  return (
  <div>
    <h2>Invoices & Receipts</h2>
    <ul>
    {invoices.map((inv: { id: string; number: string; hostedInvoiceUrl: string; amountPaid: number }) => (
      <li key={inv.id}>
      <a
        href={inv.hostedInvoiceUrl}
        target='_blank'
        rel='noopener noreferrer'
      >
        {inv.number} – ${(inv.amountPaid / 100).toFixed(2)}
      </a>
      </li>
    ))}
    </ul>
  </div>
  );
}
