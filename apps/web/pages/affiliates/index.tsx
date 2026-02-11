
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';
export default function AffiliateOffers({ offers }: any) {
  return (
  <main>
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
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const res = await authFetch(apiUrl('affiliates/offers'), { ctx });
  const offers = await res.json();

  return { props: { offers } };
};
