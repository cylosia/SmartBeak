// M1-FIX: Wrapped in AppShell for consistent navigation
import { AppShell } from '../components/AppShell';

export default function Billing() {
  return (
  <AppShell>
    <h1>Billing</h1>
    <p>Manage your subscription via the Stripe customer portal.</p>
    <form method='post' action='/api/stripe/portal'>
      <button type='submit'>Open billing portal</button>
    </form>
  </AppShell>
  );
}
