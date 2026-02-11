/**
 * ROI Hooks
 * React Query hooks for ROI calculations
 */

import { useQuery } from '@tanstack/react-query';
import { useApi } from './use-api';

export interface RoiMetrics {
  domainId: string;
  revenue: number;
  costs: number;
  roi: number;
  period: string;
  breakdown: {
    content: number;
    advertising: number;
    affiliates: number;
    other: number;
  };
}

export interface RoiReport {
  domainId: string;
  overallRoi: number;
  monthlyRoi: RoiMetrics[];
  yearlyRoi: RoiMetrics[];
  projections: {
    threeMonth: number;
    sixMonth: number;
    twelveMonth: number;
  };
}

const ROI_QUERY_KEY = 'roi';

/**
 * Hook to fetch ROI metrics
 */
export function useRoiMetrics(domainId: string | undefined, period?: string) {
  const api = useApi();
  
  return useQuery({
    queryKey: [ROI_QUERY_KEY, domainId, period],
    queryFn: async (): Promise<RoiMetrics> => {
      if (!domainId) throw new Error('Domain ID is required');
      const params = period ? `?period=${period}` : '';
      const response = await api.get(`/domains/${domainId}/roi${params}`);
      return response.data as RoiMetrics;
    },
    enabled: !!domainId,
  });
}

/**
 * Hook to fetch ROI report
 */
export function useRoiReport(domainId: string | undefined) {
  const api = useApi();
  
  return useQuery({
    queryKey: [ROI_QUERY_KEY, 'report', domainId],
    queryFn: async (): Promise<RoiReport> => {
      if (!domainId) throw new Error('Domain ID is required');
      const response = await api.get(`/domains/${domainId}/roi/report`);
      return response.data as RoiReport;
    },
    enabled: !!domainId,
  });
}
