
'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '../lib/theme';

const navLinks = [
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/affiliates', label: 'Affiliates' },
  { href: '/timeline', label: 'Timeline' },
  { href: '/sell-ready', label: 'Sell Ready' },
  { href: '/constitution', label: 'Constitution' },
  { href: '/help', label: 'Help' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
  <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr' }}>
    <a
      href="#main-content"
      style={{
        position: 'absolute',
        left: '-9999px',
        top: 'auto',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
      }}
      onFocus={(e) => { e.currentTarget.style.position = 'static'; e.currentTarget.style.width = 'auto'; e.currentTarget.style.height = 'auto'; }}
      onBlur={(e) => { e.currentTarget.style.position = 'absolute'; e.currentTarget.style.width = '1px'; e.currentTarget.style.height = '1px'; }}
    >
      Skip to main content
    </a>
    <nav aria-label="Main navigation" style={{ borderRight: '1px solid var(--border)', padding: 16 }}>
    <h3>ACP</h3>
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {navLinks.map(({ href, label }) => (
      <li key={href}>
        <a
          href={href}
          aria-current={pathname === href ? 'page' : undefined}
          style={{
            display: 'block',
            padding: '4px 0',
            fontWeight: pathname === href ? 'bold' : 'normal',
            outline: 'none',
          }}
        >
          {label}
        </a>
      </li>
      ))}
    </ul>
    <div style={{ marginTop: 24 }}>
      <ThemeToggle />
    </div>
    </nav>
    <main id="main-content" aria-label="Page content" style={{ padding: 24 }}>{children}</main>
  </div>
  );
}
