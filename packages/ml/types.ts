/**
 * ML Types
 * Type definitions for the machine learning package
 */

/**
 * ML configuration
 */
export interface MLConfig {
  /** Model provider (openai, anthropic, etc.) */
  provider: string;
  /** Model name */
  model: string;
  /** API key */
  apiKey?: string;
  /** Temperature for generation (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * ML model information
 */
export interface MLModel {
  /** Model ID */
  id: string;
  /** Model name */
  name: string;
  /** Model provider */
  provider: string;
  /** Model capabilities */
  capabilities: string[];
  /** Context window size */
  contextWindow: number;
}

/**
 * Prediction result structure
 */
export interface PredictionResult {
  /** Prediction ID */
  id: string;
  /** Prediction text/content */
  content: string;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Token usage */
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** Model used */
  model: string;
  /** Generation duration in milliseconds */
  durationMs: number;
}
