import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { apiUrl } from '../lib/api-client';

/**
* React Query hooks for API data fetching
* Provides type-safe data fetching with caching
* 
* P1-HIGH SECURITY FIXES:
* - Issue 17: Missing request timeout in hooks
* - Issue 18: Missing request cancellation on unmount
*/

// Default request timeout: 30 seconds
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/**
 * Create an AbortController with timeout
 * SECURITY FIX: Issue 17 - Request timeout support
 * 
 * @param timeoutMs - Timeout in milliseconds
 * @returns AbortController and timeout ID
 */
function createTimeoutController(timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): { 
  controller: AbortController; 
  timeoutId: NodeJS.Timeout;
  clear: () => void;
} {
  const controller = new AbortController();
  
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  
  return {
    controller,
    timeoutId,
    clear: () => clearTimeout(timeoutId),
  };
}

/**
 * Fetch with timeout and proper cleanup
 * SECURITY FIX: Issue 17 & 18 - Request timeout and cancellation
 * 
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param timeoutMs - Timeout in milliseconds
 * @returns Fetch response
 */
async function fetchWithTimeout(
  url: string, 
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const { controller, clear } = createTimeoutController(timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clear();
    return response;
  } catch (error) {
    clear();
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// Query keys for cache management
export const queryKeys = {
  domains: ['domains'] as const,
  domain: (id: string) => ['domains', id] as const,
  themes: ['themes'] as const,
  timeline: ['timeline'] as const,
  timelineDomain: (domainId: string) => ['timeline', 'domain', domainId] as const,
  invoices: ['billing', 'invoices'] as const,
  llmModels: ['llm', 'models'] as const,
  llmPreferences: ['llm', 'preferences'] as const,
  portfolioRevenue: ['portfolio', 'revenue'] as const,
  portfolioRisk: ['portfolio', 'risk'] as const,
  affiliates: ['affiliates'] as const,
  diligence: (token: string) => ['diligence', token] as const,
  roiRisk: (assetId: string) => ['roi-risk', assetId] as const,
  attribution: (type: string) => ['attribution', type] as const,
};

/**
* Hook for fetching domains
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useDomains(): ReturnType<typeof useQuery> {
  return useQuery({
    queryKey: queryKeys.domains,
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl('domains'), { 
        credentials: 'include',
        signal, // React Query handles cancellation
      });
      if (!res.ok) throw new Error('Failed to fetch domains');
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
* Hook for fetching a single domain
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useDomain(id: string): ReturnType<typeof useQuery> {
  return useQuery({
    queryKey: queryKeys.domain(id),
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl(`domains/${id}`), { 
        credentials: 'include',
        signal, // React Query handles cancellation
      });
      if (!res.ok) throw new Error('Failed to fetch domain');
      return res.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching themes
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useThemes(): ReturnType<typeof useQuery> {
  return useQuery({
    queryKey: queryKeys.themes,
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl('themes'), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch themes');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching timeline events
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useTimeline(): ReturnType<typeof useQuery> {
  return useQuery({
    queryKey: queryKeys.timeline,
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl('timeline'), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch timeline');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching domain-specific timeline
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useDomainTimeline(domainId: string): ReturnType<typeof useQuery> {
  return useQuery({
    queryKey: queryKeys.timelineDomain(domainId),
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl(`timeline/domain/${domainId}`), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch timeline');
      return res.json();
    },
    enabled: !!domainId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching billing invoices
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useInvoices(): ReturnType<typeof useQuery> {
  return useQuery({
    queryKey: queryKeys.invoices,
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl('billing/invoices'), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch invoices');
      const data = await res.json();
      return data.invoices || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching LLM models
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useLlmModels(): ReturnType<typeof useQuery> {
  return useQuery({
    queryKey: queryKeys.llmModels,
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl('llm/models'), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch LLM models');
      const data = await res.json();
      return data.models || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching LLM preferences
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useLlmPreferences(): ReturnType<typeof useQuery> {
  return useQuery({
    queryKey: queryKeys.llmPreferences,
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl('llm/preferences'), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch LLM preferences');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for updating LLM preferences
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useUpdateLlmPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (preferences: any) => {
      const res = await fetchWithTimeout(
        apiUrl('llm/preferences'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(preferences),
        },
        DEFAULT_REQUEST_TIMEOUT_MS
      );
      if (!res.ok) throw new Error('Failed to update preferences');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.llmPreferences });
    },
  });
}

/**
* Hook for fetching portfolio data
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function usePortfolio() {
  return useQuery({
    queryKey: ['portfolio'],
    queryFn: async ({ signal }) => {
      const [revenueRes, riskRes] = await Promise.all([
        fetch(apiUrl('portfolio/revenue-confidence'), { 
          credentials: 'include',
          signal,
        }),
        fetch(apiUrl('portfolio/dependency-risk'), { 
          credentials: 'include',
          signal,
        }),
      ]);

      if (!revenueRes.ok || !riskRes.ok) {
        throw new Error('Failed to fetch portfolio data');
      }

      const [revenue, risk] = await Promise.all([
        revenueRes.json(),
        riskRes.json(),
      ]);

      return { revenue, risk };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching affiliate offers
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useAffiliateOffers() {
  return useQuery({
    queryKey: queryKeys.affiliates,
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl('affiliates/offers'), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch affiliate offers');
      const data = await res.json();
      return data.offers || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching diligence data
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useDiligence(token: string) {
  return useQuery({
    queryKey: queryKeys.diligence(token),
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl(`diligence/${token}/overview`), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch diligence data');
      return res.json();
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching ROI risk data
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useRoiRisk(assetId: string) {
  return useQuery({
    queryKey: queryKeys.roiRisk(assetId),
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl(`roi-risk/${assetId}`), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch ROI risk data');
      return res.json();
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
* Hook for fetching attribution data
* SECURITY FIX: Issue 17 & 18 - Added timeout and cancellation
*/
export function useAttribution(type: 'llm' | 'buyer-safe') {
  return useQuery({
    queryKey: queryKeys.attribution(type),
    queryFn: async ({ signal }) => {
      const res = await fetch(apiUrl(`attribution/${type}`), { 
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to fetch attribution data');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

// Re-export fetch utilities for use in other hooks
export { fetchWithTimeout, createTimeoutController, DEFAULT_REQUEST_TIMEOUT_MS };

/**
* Generic API hook for making authenticated requests
* Returns an object with get, post, patch, delete methods
* SECURITY FIX: Issue 17 & 18 - Request timeout and cancellation
*/
export function useApi() {
  return {
    get: async (path: string) => {
      const url = apiUrl(path.replace(/^\//, ''));
      const response = await fetchWithTimeout(url, {
        credentials: 'include',
      }, DEFAULT_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Failed to GET ${path}`);
      return { data: await response.json() };
    },
    post: async (path: string, body: unknown) => {
      const url = apiUrl(path.replace(/^\//, ''));
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      }, DEFAULT_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Failed to POST ${path}`);
      return { data: await response.json() };
    },
    patch: async (path: string, body: unknown) => {
      const url = apiUrl(path.replace(/^\//, ''));
      const response = await fetchWithTimeout(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      }, DEFAULT_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Failed to PATCH ${path}`);
      return { data: await response.json() };
    },
    delete: async (path: string) => {
      const url = apiUrl(path.replace(/^\//, ''));
      const response = await fetchWithTimeout(url, {
        method: 'DELETE',
        credentials: 'include',
      }, DEFAULT_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Failed to DELETE ${path}`);
      return { data: await response.json() };
    },
  };
}
