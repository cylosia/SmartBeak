
import { PublicShell } from '../components/PublicShell';
export default function Register() {
  return (
  <PublicShell>
    <h1>Request access</h1>
    <p>Account creation and verification are handled by Clerk.</p>
    <a href='/sign-up'>Continue to request access</a>
  </PublicShell>
  );
}
