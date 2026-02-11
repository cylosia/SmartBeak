
import { AppShell } from '../../components/AppShell';
export default function SystemJobs() {
  return (
  <AppShell>
    <h2>Background Jobs</h2>
    <ul>
    <li>Keyword ingestion — completed</li>
    <li>Link check — running</li>
    </ul>
  </AppShell>
  );
}
