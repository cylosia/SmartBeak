import Head from 'next/head';
import { AppShell } from '../components/AppShell';

export default function Help() {
  return (
    <>
      <Head>
        {/* P2-FIX: Added per-page title. Without this, every page shows the global
            default title, giving screen reader users no orientation cue on navigation
            and making browser tabs indistinguishable during multi-domain diligence. */}
        <title>Help &amp; Documentation — ACP</title>
        <meta name="description" content="Guides and reference for ACP platform features" />
      </Head>
      <AppShell>
        <h1>Help &amp; Documentation</h1>
        {/* P3-A11Y-FIX: Added aria-label to identify the list purpose for screen reader
            users who navigate by landmarks. Without it, assistive technology announces
            "list" with no context about what the items represent. */}
        <ul aria-label="Help topics">
          <li>How ACP Works</li>
          <li>Understanding Human Intent</li>
          <li>Revenue Confidence &amp; Reconciliation</li>
          <li>Buyer Diligence Guide</li>
          <li>Glossary</li>
        </ul>
        <p>Documentation is intentionally explicit and conservative.</p>
      </AppShell>
    </>
  );
}
