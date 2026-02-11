
import { AppShell } from '../components/AppShell';
export default function Activity() {
  return (
  <AppShell>
    <h1>Activity Log</h1>
    <p>Read-only log of significant actions.</p>
    <ul>
    <li>Domain created: example.com</li>
    <li>Intent approved: Replace Affiliate Offer</li>
    <li>Domain transferred</li>
    </ul>
  </AppShell>
  );
}
