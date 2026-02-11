/**
 * LLM Hooks
 * React Query hooks for LLM operations
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { useApi } from './use-api';

export interface LLMModel {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
  supportsImages: boolean;
}

export interface GenerateInput {
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateOutput {
  text: string;
  tokensUsed: number;
  finishReason: string;
}

const LLM_QUERY_KEY = 'llm';

/**
 * Hook to fetch available LLM models
 */
export function useLLMModels() {
  const api = useApi();
  
  return useQuery({
    queryKey: [LLM_QUERY_KEY, 'models'],
    queryFn: async (): Promise<LLMModel[]> => {
      const response = await api.get('/llm/models');
      return response.data as LLMModel[];
    },
  });
}

/**
 * Hook to generate text using LLM
 */
export function useLLMGenerate() {
  const api = useApi();
  
  return useMutation({
    mutationFn: async (input: GenerateInput): Promise<GenerateOutput> => {
      const response = await api.post('/llm/generate', input);
      return response.data as GenerateOutput;
    },
  });
}
