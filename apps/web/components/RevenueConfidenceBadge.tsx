export function RevenueConfidenceBadge({ level }: { level: 'high'|'medium'|'low' }) {
  const color = level === 'high' ? 'green' : level === 'medium' ? 'orange' : 'red';
  return (
  <span role='status' aria-label={`Revenue confidence: ${level}`} style={{ color }}>
    {level.toUpperCase()} CONFIDENCE
  </span>
  );
}
