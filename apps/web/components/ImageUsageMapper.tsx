import React from 'react';
export function ImageUsageMapper({ onMap }: any) {
  return (
  <div>
    <button onClick={() => onMap('web')}>Web</button>
    <button onClick={() => onMap('pinterest')}>Pinterest</button>
    <button onClick={() => onMap('email')}>Email</button>
  </div>
  );
}
