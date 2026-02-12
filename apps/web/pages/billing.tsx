// M1-FIX: Wrapped in AppShell for consistent navigation
import { AppShell } from '../components/AppShell';

export default function Billing() {
  return (
  <AppShell>
    <h1>Billing</h1>
    <p>Manage your subscription via the Stripe customer portal.</p>
    <a href='/api/stripe/portal'>Open billing portal</a>
  </AppShell>
  );
}
