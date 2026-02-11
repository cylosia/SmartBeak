
import { GetServerSideProps } from 'next';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';
export default function Domains({ domains }: any) {
  return (
  <AppShell>
    <h1>Domains</h1>
    <p>Each domain is a first-class business asset in ACP.</p>
    <a href='/domains/new'>➕ Add domain</a>
    <table style={{ marginTop: 16 }}>
    <thead>
      <tr>
      <th>Domain</th>
      <th>Status</th>
      <th>Type</th>
      <th>Revenue Confidence</th>
      <th>Replaceability</th>
      </tr>
    </thead>
    <tbody>
      {domains.map((d: any) => (
      <tr key={d["id"]}>
        <td><a href={`/domains/${d["id"]}`}>{d.name}</a></td>
        <td>{d.status}</td>
        <td>{d.domainType}</td>
        <td>{d.revenueConfidence ?? '—'}</td>
        <td>{d.replaceability ?? '—'}</td>
      </tr>
      ))}
    </tbody>
    </table>
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const res = await authFetch(apiUrl('domains'), { ctx });
  const domains = await res.json();

  return { props: { domains } };
};
