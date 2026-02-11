
import { AppShell } from '../../components/AppShell';
export default function NotificationSettings() {
  return (
  <AppShell>
    <h1>Notification Preferences</h1>
    <label><input type='checkbox' /> Affiliate offer terminated</label><br />
    <label><input type='checkbox' /> Monetization decay</label><br />
    <label><input type='checkbox' /> Pending intents</label><br />
  </AppShell>
  );
}
