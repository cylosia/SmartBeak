
import { AppShell } from '../../components/AppShell';
export default function Roles() {
  return (
  <AppShell>
    <h2>Roles & Permissions</h2>
    <table>
    <thead>
      <tr><th>Role</th><th>View</th><th>Create Intents</th><th>Approve</th><th>Admin</th></tr>
    </thead>
    <tbody>
      <tr><td>Admin</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
      <tr><td>Editor</td><td>✓</td><td>✓</td><td>—</td><td>—</td></tr>
      <tr><td>Viewer</td><td>✓</td><td>—</td><td>—</td><td>—</td></tr>
      <tr><td>Buyer</td><td>✓ (read-only)</td><td>—</td><td>—</td><td>—</td></tr>
    </tbody>
    </table>
  </AppShell>
  );
}
