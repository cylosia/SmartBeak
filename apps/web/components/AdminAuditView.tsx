
import React, { useState } from 'react';
export function AdminAuditView({ events, onFilter }: any) {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  return (
  <div>
    <h2>Audit Events</h2>

    <div>
    <input
      placeholder='Action'
      value={action}
      onChange={(e) => setAction((e.target as HTMLInputElement).value)}
    />
    <input
      type='date'
      value={from}
      onChange={(e) => setFrom((e.target as HTMLInputElement).value)}
    />
    <input
      type='date'
      value={to}
      onChange={(e) => setTo((e.target as HTMLInputElement).value)}
    />
    <button onClick={() => onFilter({ action, from, to })}>
      Filter
    </button>
    </div>

    <table>
    <thead>
      <tr>
      <th>Time</th>
      <th>Actor</th>
      <th>Action</th>
      <th>Metadata</th>
      </tr>
    </thead>
    <tbody>
      {events.map((e: any) => (
      <tr key={e["id"]}>
        <td>{e.createdAt}</td>
        <td>{e.actorType}</td>
        <td>{e.action}</td>
        <td>
        <pre>{JSON.stringify(e.metadata, null, 2)}</pre>
        </td>
      </tr>
      ))}
    </tbody>
    </table>
  </div>
  );
}
