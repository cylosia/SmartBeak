
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
    {recommendations.length === 0 && (
    <p>No recommendations available at this time.</p>
    )}
    <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
    {recommendations.map((recommendation) => (
    <li
      key={recommendation.content_id}
      role="listitem"
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
        {recommendation.explanation.map((explanationItem, idx) => (
        <li key={idx}>{explanationItem}</li>
        ))}
      </ul>
      )}
    </li>
    ))}
    </ul>
  </div>
  );
}
