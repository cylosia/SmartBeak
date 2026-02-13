/**
 * Portfolio Hooks
 * React Query hooks for portfolio management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './use-api';

export interface PortfolioItem {
  id: string;
  domainId: string;
  type: 'content' | 'media' | 'link';
  title: string;
  url?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CreatePortfolioItemInput {
  domainId: string;
  type: 'content' | 'media' | 'link';
  title: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

const PORTFOLIO_QUERY_KEY = 'portfolio';

/**
 * Hook to fetch portfolio for a domain
 */
export function usePortfolio(domainId: string | undefined) {
  const api = useApi();
  
  return useQuery({
    queryKey: [PORTFOLIO_QUERY_KEY, domainId],
    queryFn: async (): Promise<PortfolioItem[]> => {
      if (!domainId) throw new Error('Domain ID is required');
      const response = await api.get(`/domains/${domainId}/portfolio`);
      return response.data as PortfolioItem[];
    },
    enabled: !!domainId,
  });
}

/**
 * Hook to fetch portfolio items
 */
export function usePortfolioItems(domainId: string | undefined) {
  return usePortfolio(domainId);
}

/**
 * Hook to create a portfolio item
 */
export function useCreatePortfolioItem() {
  const api = useApi();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: CreatePortfolioItemInput): Promise<PortfolioItem> => {
      const response = await api.post(`/domains/${input["domainId"]}/portfolio`, input);
      return response.data as PortfolioItem;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: [PORTFOLIO_QUERY_KEY, variables["domainId"]] });
    },
  });
}
