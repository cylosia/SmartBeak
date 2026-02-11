/**
 * Timeline Hooks
 * React Query hooks for timeline management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './use-api';

export interface TimelineEvent {
  id: string;
  domainId: string;
  type: string;
  title: string;
  description?: string;
  date: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CreateTimelineEventInput {
  domainId: string;
  type: string;
  title: string;
  description?: string;
  date?: string;
  metadata?: Record<string, unknown>;
}

const TIMELINE_QUERY_KEY = 'timeline';

/**
 * Hook to fetch timeline for a domain
 */
export function useTimeline(domainId: string | undefined) {
  const api = useApi();
  
  return useQuery({
    queryKey: [TIMELINE_QUERY_KEY, domainId],
    queryFn: async (): Promise<TimelineEvent[]> => {
      if (!domainId) throw new Error('Domain ID is required');
      const response = await api.get(`/domains/${domainId}/timeline`);
      return response.data as TimelineEvent[];
    },
    enabled: !!domainId,
  });
}

/**
 * Hook to fetch timeline events with filters
 */
export function useTimelineEvents(domainId: string | undefined, filters?: { type?: string; from?: string; to?: string }) {
  const api = useApi();
  
  return useQuery({
    queryKey: [TIMELINE_QUERY_KEY, domainId, filters],
    queryFn: async (): Promise<TimelineEvent[]> => {
      if (!domainId) throw new Error('Domain ID is required');
      const params = new URLSearchParams();
      if (filters?.type) params.append('type', filters.type);
      if (filters?.from) params.append('from', filters.from);
      if (filters?.to) params.append('to', filters.to);
      const response = await api.get(`/domains/${domainId}/timeline?${params.toString()}`);
      return response.data as unknown as TimelineEvent[];
    },
    enabled: !!domainId,
  });
}

/**
 * Hook to create a timeline event
 */
export function useCreateTimelineEvent() {
  const api = useApi();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: CreateTimelineEventInput): Promise<TimelineEvent> => {
      const response = await api.post(`/domains/${input["domainId"]}/timeline`, input);
      return response.data as TimelineEvent;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [TIMELINE_QUERY_KEY, variables["domainId"]] });
    },
  });
}
