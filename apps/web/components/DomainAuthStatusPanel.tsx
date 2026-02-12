
import React from 'react';

interface DomainAuthStatusPanelProps {
  status: {
    spf: boolean;
    dkim: boolean;
    dmarc: boolean;
  };
}

export function DomainAuthStatusPanel({ status }: DomainAuthStatusPanelProps) {
  return (
  <div>
    <h4>Email Domain Authentication</h4>
    <ul>
    <li>SPF: {status.spf ? 'OK' : 'Missing'}</li>
    <li>DKIM: {status.dkim ? 'OK' : 'Missing'}</li>
    <li>DMARC: {status.dmarc ? 'OK' : 'Missing'}</li>
    </ul>
  </div>
  );
}
