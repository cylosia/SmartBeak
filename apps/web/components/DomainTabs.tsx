export function DomainTabs({ domainId, active }: { domainId: string; active: string }) {
  const tabs = [
  ['overview','Overview'],
  ['content','Content'],
  ['authors','Authors'],
  ['personas','Personas'],
  ['keywords','Keywords'],
  ['links','Links'],
  ['email','Email & Audience'],
  ['affiliates','Affiliates'],
  ['integrations','Integrations'],
  ['theme','Theme'],
  ['deployment','Deployment'],
  ['buyer','Buyer & Exit']
  ];
  return (
  <nav style={{ marginBottom: 24 }}>
    {tabs.map(([key,label]) => (
    <a
      key={key}
      href={`/domains/${domainId}/${key}`}
      style={{ marginRight: 16, fontWeight: active === key ? 'bold' : 'normal' }}
    >
      {label}
    </a>
    ))}
  </nav>
  );
}
