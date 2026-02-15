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
    tabIndex={0}
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
        href={`/domains/${domainId}/${key}`}
        style={{
          marginRight: 16,
          fontWeight: isActive ? 'bold' : 'normal',
          textDecoration: isActive ? 'underline' : 'none',
          outline: 'none',
        }}
      >
        {label}
      </a>
      );
    })}
  </div>
  );
}
