'use client';

import { useCallback, useRef, type KeyboardEvent } from 'react';

const tabs = [
  ['overview', 'Overview'],
  ['content', 'Content'],
  ['authors', 'Authors'],
  ['personas', 'Personas'],
  ['keywords', 'Keywords'],
  ['links', 'Links'],
  ['email', 'Email & Audience'],
  ['affiliates', 'Affiliates'],
  ['integrations', 'Integrations'],
  ['theme', 'Theme'],
  ['deployment', 'Deployment'],
  ['buyer', 'Buyer & Exit'],
] as const;

export function DomainTabs({ domainId, active }: { domainId: string; active: string }) {
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const currentIndex = tabs.findIndex(([key]) => key === active);
      // P1-ARIA-FIX: Guard against invalid `active` prop. If active doesn't match
      // any tab key, findIndex returns -1 and modulo arithmetic wraps to the last
      // tab ((-1 + 1) % 12 === 0 for ArrowRight, (-1 - 1 + 12) % 12 === 10 for
      // ArrowLeft) causing unexpected focus jumps to unrelated tabs.
      if (currentIndex === -1) return;

      let newIndex = currentIndex;

      if (e.key === 'ArrowRight') {
        newIndex = (currentIndex + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft') {
        newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        newIndex = 0;
      } else if (e.key === 'End') {
        newIndex = tabs.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      tabRefs.current[newIndex]?.focus();
    },
    [active],
  );

  return (
  <div
    role="tablist"
    aria-label="Domain sections"
    style={{ marginBottom: 24 }}
    onKeyDown={handleKeyDown}
  >
    {tabs.map(([key, label], index) => {
      const isActive = active === key;
      return (
      <a
        key={key}
        ref={(el) => { tabRefs.current[index] = el; }}
        role="tab"
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        href={`/domains/${encodeURIComponent(domainId)}/${key}`}
        style={{
          marginRight: 16,
          fontWeight: isActive ? 'bold' : 'normal',
          textDecoration: isActive ? 'underline' : 'none',
          // P2-A11Y-FIX: Removed outline:none. Suppressing the focus ring without
          // providing an equivalent custom indicator violates WCAG 2.1 SC 2.4.7
          // (Focus Visible). Keyboard users cannot determine which tab has focus.
        }}
      >
        {label}
      </a>
      );
    })}
  </div>
  );
}
