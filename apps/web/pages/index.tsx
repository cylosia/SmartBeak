
import { PublicShell } from '../components/PublicShell';
export default function Home() {
  return (
  <PublicShell>
    <h1>ACP — Audience & Content Platform</h1>
    <p style={{ fontSize: 18 }}>
    A business control plane for digital assets.
    </p>

    <p>
    ACP records and governs human decisions across content, SEO,
    affiliate revenue, and audience — with AI used strictly as an
    advisory tool.
    </p>

    <p>
    There are no magic buttons. No auto-publishing. No black-box
    optimization. Every material action is deliberate, reviewable,
    and auditable.
    </p>

    <h2>Who ACP is for</h2>
    <ul>
    <li>Affiliate operators managing revenue risk</li>
    <li>Agencies responsible for client outcomes</li>
    <li>Founders preparing assets for sale</li>
    <li>Buyers performing technical and revenue diligence</li>
    </ul>

    <h2>What makes ACP different</h2>
    <ul>
    <li>Human intent is the only authority</li>
    <li>AI is advisory only — never autonomous</li>
    <li>Revenue is tracked from authoritative sources</li>
    <li>History is immutable and explainable</li>
    </ul>

    <div style={{ marginTop: 32 }}>
    <a href='/login' style={{ marginRight: 16 }}>Log in</a>
    <a href='/register' style={{ marginRight: 16 }}>Request access</a>
    <a href='/demo'>View demo</a>
    </div>
  </PublicShell>
  );
}
