
import { AppShell } from '../../components/AppShell';
export default function NewDomain() {
  return (
  <AppShell>
    <h1>Add Domain</h1>
    <p>
    Adding a domain creates a new asset boundary in ACP.
    Publishing and deployment are separate steps.
    </p>

    <form>
    <label>
      Domain name<br />
      <input type='text' placeholder='example.com' />
    </label><br /><br />

    <label>
      Domain type<br />
      <select>
      <option>Content</option>
      <option>Affiliate</option>
      <option>Lead generation</option>
      <option>Mixed</option>
      </select>
    </label><br /><br />

    <label>
      Intended use (optional)<br />
      <textarea placeholder="Notes about this domain's purpose" />
    </label><br /><br />

    <button type='submit'>Create domain (draft)</button>
    </form>
  </AppShell>
  );
}
