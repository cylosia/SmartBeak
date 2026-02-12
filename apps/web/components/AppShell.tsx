
import React from 'react';
import { ThemeToggle } from '../lib/theme';
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
  <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr' }}>
    <nav style={{ borderRight: '1px solid var(--border)', padding: 16 }}>
    <h3>ACP</h3>
    <ul>
      <li><a href='/portfolio'>Portfolio</a></li>
      <li><a href='/affiliates'>Affiliates</a></li>
      <li><a href='/timeline'>Timeline</a></li>
      <li><a href='/sell-ready'>Sell Ready</a></li>
      <li><a href='/constitution'>Constitution</a></li>
      <li><a href='/help'>Help</a></li>
    </ul>
    <div style={{ marginTop: 24 }}>
      <ThemeToggle />
    </div>
    </nav>
    <main style={{ padding: 24 }}>{children}</main>
  </div>
  );
}
