
import React from 'react';
export function CompetitorInventoryView({ pages }: any) {
  return (
  <div>
    <h2>Competitor Content Inventory</h2>
    <table>
    <thead>
      <tr>
      <th>URL</th>
      <th>Type</th>
      <th>Last Updated</th>
      </tr>
    </thead>
    <tbody>
      {pages.map((p: any) => (
      <tr key={p.url}>
        <td>{p.url}</td>
        <td>{p.inferred_type}</td>
        <td>{p.lastmod || 'Unknown'}</td>
      </tr>
      ))}
    </tbody>
    </table>
  </div>
  );
}
