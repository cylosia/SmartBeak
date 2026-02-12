
import React from 'react';

interface Org {
  id: string;
  plan: string;
  plan_status: string;
}

interface AdminBillingDashboardProps {
  orgs: Org[];
}

export function AdminBillingDashboard({ orgs }: AdminBillingDashboardProps) {
  return (
  <div>
    <h2>Billing Overview</h2>
    <table>
    <thead>
      <tr>
      <th>Org</th>
      <th>Plan</th>
      <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {orgs.map((o: Org) => (
      <tr key={o["id"]}>
        <td>{o["id"]}</td>
        <td>{o.plan}</td>
        <td>{o.plan_status}</td>
      </tr>
      ))}
    </tbody>
    </table>
  </div>
  );
}
