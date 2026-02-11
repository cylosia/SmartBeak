
import React from 'react';
export function DomainAuthStatusPanel({ status }: any) {
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
