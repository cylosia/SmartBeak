/**
 * Billing Hooks
 * React Query hooks for billing and subscription management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './use-api';

export interface BillingInfo {
  orgId: string;
  plan: string;
  status: 'active' | 'inactive' | 'past_due' | 'canceled';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  createdAt: string;
  pdfUrl?: string;
}

export interface SubscribeInput {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

const BILLING_QUERY_KEY = 'billing';
const INVOICES_QUERY_KEY = 'invoices';

/**
 * Hook to fetch billing information
 */
export function useBillingInfo() {
  const api = useApi();
  
  return useQuery({
    queryKey: [BILLING_QUERY_KEY],
    queryFn: async (): Promise<BillingInfo> => {
      const response = await api.get('/billing/info');
      return response.data as BillingInfo;
    },
  });
}

/**
 * Hook to fetch invoices
 */
export function useInvoices() {
  const api = useApi();
  
  return useQuery({
    queryKey: [INVOICES_QUERY_KEY],
    queryFn: async (): Promise<Invoice[]> => {
      const response = await api.get('/billing/invoices');
      return response.data as Invoice[];
    },
  });
}

/**
 * Hook to create a subscription
 */
export function useSubscribe() {
  const api = useApi();
  
  return useMutation({
    mutationFn: async (input: SubscribeInput): Promise<{ checkoutUrl: string }> => {
      const response = await api.post('/billing/checkout', input);
      return response.data as { checkoutUrl: string };
    },
  });
}
