
import { PublicShell } from '../components/PublicShell';
export default function Login() {
  return (
  <PublicShell>
    <h1>Log in</h1>
    <p>Authentication is handled securely via Clerk.</p>
    <a href='/sign-in'>Continue to sign in</a>
  </PublicShell>
  );
}
