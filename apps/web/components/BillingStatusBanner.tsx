export function BillingStatusBanner({ status }: { status: 'active'|'past_due'|'canceled'|'trialing' }) {
  if (status === 'active') return null;
  const msg = status === 'past_due'
    ? 'Billing issue detected. The system is in read-only mode.'
    : status === 'trialing'
    ? 'You are in a free trial. Upgrade anytime to unlock all features.'
    : 'Subscription inactive. Read-only access only.';
  return (
    <div role='alert' style={{ background: '#332', padding: 12, marginBottom: 12 }}>
      <strong>{msg}</strong>
    </div>
  );
}
