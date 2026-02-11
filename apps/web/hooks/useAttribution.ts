/**
 * Attribution Hooks
 * React Query hooks for attribution modeling
 */

import { useQuery } from '@tanstack/react-query';
import { useApi } from './use-api';

export interface AttributionModel {
  id: string;
  name: string;
  type: 'first_touch' | 'last_touch' | 'linear' | 'time_decay' | 'position_based';
  description: string;
}

export interface AttributionReport {
  domainId: string;
  modelId: string;
  period: string;
  touchpoints: AttributionTouchpoint[];
  conversions: AttributionConversion[];
}

export interface AttributionTouchpoint {
  id: string;
  channel: string;
  source: string;
  medium: string;
  credit: number;
}

export interface AttributionConversion {
  id: string;
  value: number;
  date: string;
  touchpointIds: string[];
}

const ATTRIBUTION_QUERY_KEY = 'attribution';

/**
 * Hook to fetch attribution models
 */
export function useAttributionModel() {
  const api = useApi();
  
  return useQuery({
    queryKey: [ATTRIBUTION_QUERY_KEY, 'models'],
    queryFn: async (): Promise<AttributionModel[]> => {
      const response = await api.get('/attribution/models');
      return response.data as AttributionModel[];
    },
  });
}

/**
 * Hook to fetch attribution report
 */
export function useAttributionReport(domainId: string | undefined, modelId?: string, period?: string) {
  const api = useApi();
  
  return useQuery({
    queryKey: [ATTRIBUTION_QUERY_KEY, 'report', domainId, modelId, period],
    queryFn: async (): Promise<AttributionReport> => {
      if (!domainId) throw new Error('Domain ID is required');
      const params = new URLSearchParams();
      if (modelId) params.append('model', modelId);
      if (period) params.append('period', period);
      const query = params.toString() ? `?${params.toString()}` : '';
      const response = await api.get(`/domains/${domainId}/attribution${query}`);
      return response.data as AttributionReport;
    },
    enabled: !!domainId,
  });
}
