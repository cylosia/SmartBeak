
import { usePathname } from 'next/navigation';
import React from 'react';

import { ThemeToggle } from '../lib/theme';
export interface PublicShellProps {
  children: React.ReactNode;
}

export function PublicShell({ children }: PublicShellProps) {
  const pathname = usePathname();

  const getLinkProps = (href: string): { href: string; 'aria-label': string; 'aria-current'?: 'page' | undefined } => ({
  href,
  'aria-label': href === '/demo' ? 'View demo' : href === '/pricing' ? 'View pricing' : 'Log in to your account',
  'aria-current': pathname === href ? 'page' : undefined,
  });

  return (
  <div style={{ maxWidth: 960, margin: '0 auto', padding: 32 }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
    <strong>ACP</strong>
    <nav style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <a {...getLinkProps('/demo')}>Demo</a>
      <a {...getLinkProps('/pricing')}>Pricing</a>
      <a {...getLinkProps('/login')}>Log in</a>
      <ThemeToggle />
    </nav>
    </header>
    {children}
    <footer style={{ marginTop: 64, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
    <a href='/constitution' aria-label='View ACP Constitution'>ACP Constitution</a>
    </footer>
  </div>
  );
}
