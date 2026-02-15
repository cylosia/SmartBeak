
import { useState } from 'react';
export function AudioEditor() {
  const [url, setUrl] = useState('');
  return (
  <div>
    <h4>Audio</h4>
    <input value={url} onChange={(e) => setUrl((e.target as HTMLInputElement).value)} placeholder='Audio URL' />
    {url && <audio controls src={url} style={{ marginTop: 12 }}><track kind="captions" /></audio>}
  </div>
  );
}
