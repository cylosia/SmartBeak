'use client';

import { useState } from 'react';

import { RichTextEditor } from './RichTextEditor';
export function WebEditor() {
  const [html, setHtml] = useState('');
  return (
  <div>
    <h4>Web / Blog Editor</h4>
    <RichTextEditor content={html} onChange={setHtml} />
  </div>
  );
}
