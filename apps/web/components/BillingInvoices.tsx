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
    title='Unable to load invoices'
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
    {invoices.map((inv, index) => (
      <li key={inv.id ?? inv.number ?? String(index)}>
      <a
        href={inv.pdfUrl ?? '#'}
        target='_blank'
        rel='noopener noreferrer'
      >
        {inv.id} – ${(inv.amount / 100).toFixed(2)}
      </a>
      </li>
    ))}
    </ul>
  </div>
  );
}
