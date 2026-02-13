/**
 * Domain Hooks
 * React Query hooks for domain management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './use-api';

export interface Domain {
  id: string;
  name: string;
  url: string;
  status: 'active' | 'inactive' | 'pending';
  orgId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDomainInput {
  name: string;
  url: string;
}

export interface UpdateDomainInput {
  name?: string;
  url?: string;
  status?: 'active' | 'inactive' | 'pending';
}

const DOMAIN_QUERY_KEY = 'domains';

/**
 * Hook to fetch a single domain
 */
export function useDomain(domainId: string | undefined) {
  const api = useApi();
  
  return useQuery({
    queryKey: [DOMAIN_QUERY_KEY, domainId],
    queryFn: async (): Promise<Domain> => {
      if (!domainId) throw new Error('Domain ID is required');
      const response = await api.get<Domain>(`/domains/${domainId}`);
      return response.data;
    },
    enabled: !!domainId,
  });
}

/**
 * Hook to fetch all domains for the current organization
 */
export function useDomainList() {
  const api = useApi();
  
  return useQuery({
    queryKey: [DOMAIN_QUERY_KEY],
    queryFn: async (): Promise<Domain[]> => {
      const response = await api.get<Domain[]>('/domains');
      return response.data;
    },
  });
}

/**
 * Hook to create a new domain
 */
export function useCreateDomain() {
  const api = useApi();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: CreateDomainInput) => {
      const response = await api.post<Domain>('/domains', input);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [DOMAIN_QUERY_KEY] });
    },
  });
}

/**
 * Hook to update a domain
 */
export function useUpdateDomain() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ domainId, input }: { domainId: string; input: UpdateDomainInput }) => {
      const response = await api.patch<Domain>(`/domains/${domainId}`, input);
      return response.data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: [DOMAIN_QUERY_KEY, variables.domainId] });
      void queryClient.invalidateQueries({ queryKey: [DOMAIN_QUERY_KEY] });
    },
  });
}

/**
 * Hook to delete a domain
 */
export function useDeleteDomain() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (domainId: string): Promise<void> => {
      await api.delete(`/domains/${domainId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [DOMAIN_QUERY_KEY] });
    },
  });
}
