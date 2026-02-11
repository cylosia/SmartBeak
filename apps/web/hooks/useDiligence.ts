/**
 * Diligence Hooks
 * React Query hooks for due diligence operations
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { useApi } from './use-api';

export interface DiligenceCheck {
  id: string;
  domainId: string;
  type: 'seo' | 'technical' | 'content' | 'legal';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  score?: number;
  findings?: DiligenceFinding[];
  createdAt: string;
  completedAt?: string;
}

export interface DiligenceFinding {
  category: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  recommendation?: string;
}

export interface DiligenceReport {
  domainId: string;
  overallScore: number;
  checks: DiligenceCheck[];
  summary: {
    critical: number;
    warning: number;
    info: number;
  };
}

const DILIGENCE_QUERY_KEY = 'diligence';

/**
 * Hook to run a diligence check
 */
export function useDiligenceCheck() {
  const api = useApi();
  
  return useMutation({
    mutationFn: async ({ domainId, type }: { domainId: string; type: string }) => {
      const response = await api.post(`/domains/${domainId}/diligence`, { type });
      return response as unknown as DiligenceCheck;
    },
  });
}

/**
 * Hook to fetch diligence report
 */
export function useDiligenceReport(domainId: string | undefined) {
  const api = useApi();
  
  return useQuery({
    queryKey: [DILIGENCE_QUERY_KEY, domainId],
    queryFn: async () => {
      if (!domainId) throw new Error('Domain ID is required');
      const response = await api.get(`/domains/${domainId}/diligence/report`);
      return response as unknown as DiligenceReport;
    },
    enabled: !!domainId,
  });
}
