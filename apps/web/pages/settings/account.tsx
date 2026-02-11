
import { AppShell } from '../../components/AppShell';
export default function AccountSettings() {
  return (
  <AppShell>
    <h1>Account Settings</h1>
    <form>
    <label>Organization Name<br /><input type='text' /></label><br /><br />
    <label>Primary Contact Email<br /><input type='email' /></label><br /><br />
    <label>Timezone<br /><input type='text' /></label><br /><br />
    <label>Reporting Currency<br /><input type='text' /></label><br /><br />
    <button type='submit'>Save</button>
    </form>
  </AppShell>
  );
}
