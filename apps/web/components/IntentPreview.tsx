export function IntentPreview({ intent }: { intent: any }) {
  return (
  <div>
    <h2>Review Intent</h2>
    <p><strong>Type:</strong> {intent.intentType}</p>
    <p><strong>Justification:</strong> {intent.justification}</p>
    <pre>{JSON.stringify(intent.intentScope, null, 2)}</pre>
  </div>
  );
}
