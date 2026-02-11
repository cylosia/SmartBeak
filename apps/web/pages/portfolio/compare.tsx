
import { AppShell } from '../../components/AppShell';
export default function PortfolioCompare() {
  return (
  <AppShell>
    <h1>Portfolio Comparison</h1>
    <p>Compare domains by revenue, risk, and replaceability.</p>
    <table>
    <thead>
      <tr><th>Domain</th><th>Revenue</th><th>Risk</th><th>Replaceability</th></tr>
    </thead>
    <tbody>
      <tr><td>example.com</td><td>$12k/mo</td><td>Low</td><td>High</td></tr>
    </tbody>
    </table>
  </AppShell>
  );
}
