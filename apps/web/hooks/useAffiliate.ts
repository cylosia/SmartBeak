/**
 * Affiliate Hooks
 * React Query hooks for affiliate management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './use-api';

export interface Affiliate {
  id: string;
  name: string;
  network: string;
  commissionRate: number;
  status: 'active' | 'inactive' | 'pending';
  createdAt: string;
}

export interface CreateAffiliateInput {
  name: string;
  network: string;
  commissionRate: number;
}

export interface UpdateAffiliateInput {
  name?: string;
  network?: string;
  commissionRate?: number;
  status?: 'active' | 'inactive' | 'pending';
}

const AFFILIATE_QUERY_KEY = 'affiliates';

/**
 * Hook to fetch all affiliates
 */
export function useAffiliates() {
  const api = useApi();
  
  return useQuery({
    queryKey: [AFFILIATE_QUERY_KEY],
    queryFn: async (): Promise<Affiliate[]> => {
      const response = await api.get('/affiliates');
      return response.data as Affiliate[];
    },
  });
}

/**
 * Hook to create an affiliate
 */
export function useCreateAffiliate() {
  const api = useApi();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: CreateAffiliateInput): Promise<Affiliate> => {
      const response = await api.post('/affiliates', input);
      return response.data as Affiliate;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [AFFILIATE_QUERY_KEY] });
    },
  });
}

/**
 * Hook to update an affiliate
 */
export function useUpdateAffiliate() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ affiliateId, input }: { affiliateId: string; input: UpdateAffiliateInput }): Promise<Affiliate> => {
      const response = await api.patch(`/affiliates/${affiliateId}`, input);
      return response.data as Affiliate;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [AFFILIATE_QUERY_KEY] });
    },
  });
}
