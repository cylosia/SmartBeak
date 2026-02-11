/**
* SERP intelligence data for content ideas
*/
export interface SERPIntelligence {
  dominant_pattern?: string;
  weakness_signals?: string[];
  volatility?: string;
}

/**
* Internal competition information
*/
export interface InternalCompetition {
  type?: string;
  notes?: string;
}

/**
* Content format specifications
*/
export interface ContentFormats {
  primary?: string;
  secondary?: string[];
}

/**
* Asset value assessment
*/
export interface AssetValue {
  buyer_appeal?: string;
  rationale?: string;
}

/**
* AI confidence scoring
*/
export interface AIConfidence {
  score?: number;
  reason?: string;
}

/**
* Content idea advisory with strategic guidance
*/
export interface ContentIdeaAdvisory {
  business_objective?: string;
  lifecycle_role?: string;
  serp_intelligence?: SERPIntelligence;
  effort_estimate?: string;
  review_burden?: string[];
  internal_competition?: InternalCompetition;
  site_graph_role?: string;
  formats?: ContentFormats;
  channel_fit?: Record<string, 'high' | 'medium' | 'low'>;
  experiment_potential?: string[];
  measurement_clarity?: string;
  asset_value?: AssetValue;
  time_horizon?: string;
  ai_confidence?: AIConfidence;
  known_unknowns?: string[];
}
