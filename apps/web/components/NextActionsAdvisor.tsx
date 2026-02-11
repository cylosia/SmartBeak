
import React from 'react';
export interface Recommendation {
  content_id: string;
  action?: string;
  priority_score?: number;
  explanation?: string[];
}

export interface NextActionsAdvisorProps {
  recommendations?: Recommendation[];
}

export function NextActionsAdvisor({ recommendations = [] }: NextActionsAdvisorProps) {
  return (
  <div>
    <h2>What Should I Work on Next?</h2>
    {recommendations.map((recommendation) => (
    <div
      key={recommendation.content_id}
      style={{
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      padding: 12,
      marginBottom: 10
      }}
    >
      <strong>Action:</strong> {(recommendation.action ?? '').toUpperCase()}<br />
      <strong>Priority:</strong> {recommendation.priority_score ?? 0}
      {Array.isArray(recommendation.explanation) && recommendation.explanation.length > 0 && (
      <ul>
        {recommendation.explanation.map((explanationItem) => (
        <li key={explanationItem}>{explanationItem}</li>
        ))}
      </ul>
      )}
    </div>
    ))}
  </div>
  );
}
