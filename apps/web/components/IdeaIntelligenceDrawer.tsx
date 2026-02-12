
import React from 'react';

interface Advisory {
  business_objective: string;
  lifecycle_role: string;
  serp_intelligence?: { dominant_pattern?: string };
  ai_confidence?: { score?: number | string };
}

interface IdeaIntelligenceDrawerProps {
  advisory: Advisory | null;
}

export function IdeaIntelligenceDrawer({ advisory }: IdeaIntelligenceDrawerProps) {
  if (!advisory) return null;

  return (
  <div>
    <h3>Strategy</h3>
    <p>Objective: {advisory.business_objective}</p>
    <p>Lifecycle: {advisory.lifecycle_role}</p>

    <h3>SERP Reality</h3>
    <p>Pattern: {advisory.serp_intelligence?.dominant_pattern}</p>

    <h3>Confidence</h3>
    <p>{advisory.ai_confidence?.score}</p>
  </div>
  );
}
