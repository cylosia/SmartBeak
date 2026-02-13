
import { useState, useEffect, useRef } from 'react';
import { t } from '../../lib/i18n';

export function ImageEditor() {
  const [preview, setPreview] = useState<string | null>(null);
  const previousUrlRef = useRef<string | null>(null);

  // P2-2 FIX: Revoke previous blob URL to prevent memory leak
  useEffect(() => {
    return () => {
      if (previousUrlRef.current) {
        URL.revokeObjectURL(previousUrlRef.current);
      }
    };
  }, []);

  return (
  <div>
    <h4>{t('images.editorTitle')}</h4>
    <input
    type='file'
    accept='image/*'
    aria-label={t('images.editorTitle')}
    onChange={(e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        // Revoke previous URL before creating new one
        if (previousUrlRef.current) {
          URL.revokeObjectURL(previousUrlRef.current);
        }
        const newUrl = URL.createObjectURL(file);
        previousUrlRef.current = newUrl;
        setPreview(newUrl);
      }
    }}
    />
    {preview && <img src={preview} alt={t('images.uploadedPreview')} style={{ maxWidth: '100%', marginTop: 12 }} />}
  </div>
  );
}
