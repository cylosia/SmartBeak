
import React from 'react';
export function AdminBillingDashboard({ orgs }: any) {
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
      {orgs.map((o: any) => (
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
