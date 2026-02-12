import React from 'react';

interface ImageUsageMapperProps {
  onMap: (platform: string) => void;
}

export function ImageUsageMapper({ onMap }: ImageUsageMapperProps) {
  return (
  <div>
    <button onClick={() => onMap('web')}>Web</button>
    <button onClick={() => onMap('pinterest')}>Pinterest</button>
    <button onClick={() => onMap('email')}>Email</button>
  </div>
  );
}
