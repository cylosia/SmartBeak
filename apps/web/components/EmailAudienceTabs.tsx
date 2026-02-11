export function EmailAudienceTabs({ domainId, active }: { domainId: string; active: string }) {
  const tabs = [
  ['lead-magnets','Lead Magnets'],
  ['series','Autoresponder Series'],
  ['subscribers','Subscribers'],
  ['performance','Performance']
  ];
  return (
  <nav style={{ marginBottom: 24 }}>
    {tabs.map(([key,label]) => (
    <a
      key={key}
      href={`/domains/${domainId}/email/${key}`}
      style={{ marginRight: 16, fontWeight: active === key ? 'bold' : 'normal' }}
    >
      {label}
    </a>
    ))}
  </nav>
  );
}
