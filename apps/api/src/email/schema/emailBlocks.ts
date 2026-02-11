export type EmailBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'image'; src: string; alt: string; link?: string }
  | { type: 'button'; text: string; url: string }
  | { type: 'divider' };

export type ComplianceFooter = {
  physical_address: string;
  unsubscribe_link: string;
  compliance_copy: string;
};

export type EmailMessage = {
  id: string;
  subject: string;
  preview_text?: string;
  blocks: EmailBlock[];
  footer: ComplianceFooter;
};
