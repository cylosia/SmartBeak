
import { AppShell } from '../../components/AppShell';
export default function UsersAccess() {
  return (
  <AppShell>
    <h1>Users & Access</h1>
    <p>Invite and manage users in this organization.</p>
    <table>
    <thead>
      <tr><th>Email</th><th>Role</th><th>Status</th></tr>
    </thead>
    <tbody>
      <tr><td>admin@example.com</td><td>Admin</td><td>Active</td></tr>
    </tbody>
    </table>
    <br />
    <button>Invite User</button>
  </AppShell>
  );
}
