export default function Onboarding() {
  const steps = [
  'Understand Human Intent & Governance',
  'Configure Affiliate Offers',
  'Review Revenue Confidence',
  'Practice Replacement Workflow',
  'Prepare Buyer Diligence'
  ];
  return (
  <main>
    <h1>Getting Started</h1>
    <ol>
    {steps.map((s, i) => (
      <li key={i}>{s}</li>
    ))}
    </ol>
    <p>This walkthrough explains how ACP protects decisions.</p>
  </main>
  );
}
