export default function SellReady() {
  const checklist = [
  'Revenue confidence documented',
  'Affiliate dependencies disclosed',
  'Replaceability assessed',
  'Historical decisions auditable',
  'No critical unresolved risks'
  ];

  return (
  <main>
    <h1>Ready to Sell?</h1>
    <ul>
    {checklist.map((c, i) => (
      <li key={i}>⬜ {c}</li>
    ))}
    </ul>
    <p>
    This checklist is advisory. It highlights readiness, not guarantees.
    </p>
  </main>
  );
}
