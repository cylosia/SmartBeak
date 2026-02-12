
import React from 'react';

interface CompetitorPage {
  url: string;
  inferred_type: string;
  lastmod: string | null;
}

interface CompetitorInventoryViewProps {
  pages: CompetitorPage[];
}

export function CompetitorInventoryView({ pages }: CompetitorInventoryViewProps) {
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
      {pages.map((p: CompetitorPage) => (
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
