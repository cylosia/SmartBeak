
import { PublicShell } from '../components/PublicShell';
export default function Pricing() {
  return (
  <PublicShell>
    <h1>Pricing</h1>

    <h2>Solo Operator</h2>
    <p>$49 / month — single domain, full governance</p>
    <a href='/checkout?plan=solo'>Subscribe</a>

    <h2>Portfolio / Agency</h2>
    <p>$199 / month — multiple domains, buyer diligence</p>
    <a href='/checkout?plan=portfolio'>Subscribe</a>

    <h2>Enterprise / Buyer</h2>
    <p>Custom pricing — acquisition & governance</p>
    <a href='/contact'>Contact sales</a>
  </PublicShell>
  );
}
