
'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '../lib/theme';
import { useTranslation } from '../lib/i18n';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useTranslation();

  const navLinks = [
    { href: '/portfolio', label: t('nav.portfolio') },
    { href: '/affiliates', label: t('nav.affiliates') },
    { href: '/timeline', label: t('nav.timeline') },
    { href: '/sell-ready', label: t('nav.sellReady') },
    { href: '/constitution', label: t('nav.constitution') },
    { href: '/help', label: t('nav.help') },
  ];

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
      {t('common.skipToMain')}
    </a>
    <nav aria-label={t('a11y.mainNav')} style={{ borderRight: '1px solid var(--border)', padding: 16 }}>
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
            // P1-A11Y-FIX: Removed outline:none. Suppressing the focus ring without
            // a custom replacement violates WCAG 2.1 SC 2.4.7 (Focus Visible).
            // The same bug was fixed in DomainTabs.tsx but was missed here,
            // making all primary nav links invisible to keyboard users.
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
    <main id="main-content" aria-label={t('a11y.pageContent')} style={{ padding: 24 }}>{children}</main>
  </div>
  );
}
