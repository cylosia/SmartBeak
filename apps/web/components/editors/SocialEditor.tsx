
import React, { useState, useEffect } from 'react';
export interface SocialEditorProps {
  value?: string;
  onChange?: (value: string) => void;
}

export function SocialEditor({ value = '', onChange }: SocialEditorProps) {
  const [internalValue, setInternalValue] = useState(value);

  // Sync internal state when prop value changes (controlled pattern)
  useEffect(() => {
  setInternalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const newValue = (e.target as HTMLTextAreaElement).value;
  setInternalValue(newValue);
  onChange?.(newValue);
  };

  // Use internalValue for display (fully controlled pattern)
  return (
  <div>
    <h4>Social Post</h4>
    <textarea
    value={internalValue}
    onChange={handleChange}
    placeholder='Post copy'
    aria-label='Social post content'
    />
    <p>Platform selection occurs at publish time.</p>
  </div>
  );
}
