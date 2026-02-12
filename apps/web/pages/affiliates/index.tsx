
import { GetServerSideProps } from 'next';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';
// M1-FIX: Wrapped in AppShell for consistent navigation
export default function AffiliateOffers({ offers }: any) {
  return (
  <AppShell>
    <h1>Affiliate Offers</h1>
    <table>
    <thead>
      <tr>
      <th>Merchant</th>
      <th>Status</th>
      <th>Risk Notes</th>
      </tr>
    </thead>
    <tbody>
      {offers.map((o: any) => (
      <tr key={o["id"]}>
        <td>{o.merchantName}</td>
        <td>{o.status}</td>
        <td>{o.riskNotes}</td>
      </tr>
      ))}
    </tbody>
    </table>
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const res = await authFetch(apiUrl('affiliates/offers'), { ctx });
  // C10-FIX: Destructure offers array from response (was passing full object including pagination)
  const { offers } = await res.json();

  return { props: { offers: offers || [] } };
};
