
import { useState } from 'react';
export function ImageEditor() {
  const [preview, setPreview] = useState<string | null>(null);

  return (
  <div>
    <h4>Image Asset</h4>
    <input
    type='file'
    accept='image/*'
    onChange={(e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) setPreview(URL.createObjectURL(file));
    }}
    />
    {preview && <img src={preview} style={{ maxWidth: '100%', marginTop: 12 }} />}
  </div>
  );
}
