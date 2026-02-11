export type DeliverabilityAdvisory = {
  level: 'info' | 'warning';
  message: string;
  recommendation?: string;
};

export function checkDeliverability(input: {
  fromDomain: string;
  siteDomain: string;
  body: string;
  links: number;
  images: number;
  hasUnsubscribe: boolean;
  hasAddress: boolean;
  subject: string;
}): DeliverabilityAdvisory[] {
  const adv: DeliverabilityAdvisory[] = [];
  if (input.fromDomain !== input.siteDomain) {
  adv.push({ level: 'warning', message: 'From domain does not match site domain', recommendation: 'Use a branded sending domain.' });
  }
  if (!input.hasUnsubscribe) adv.push({ level: 'warning', message: 'Missing unsubscribe link' });
  if (!input.hasAddress) adv.push({ level: 'warning', message: 'Missing physical address' });
  if (input.images > 0 && input.links === 0) adv.push({ level: 'info', message: 'Image-heavy email', recommendation: 'Add descriptive text.' });
  if (/[A-Z]{6,}/.test(input.subject)) adv.push({ level: 'info', message: 'Excessive capitalization in subject' });
  return adv;
}
