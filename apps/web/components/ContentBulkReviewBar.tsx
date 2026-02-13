import { useTranslation } from '../lib/i18n';

export function ContentBulkReviewBar({ selected }: { selected: string[] }) {
  const { t } = useTranslation();
  return (
  <div aria-live="polite" aria-atomic="true">
    {selected.length > 0 && (
    <div style={{ padding: 12, background: '#222', marginBottom: 12 }}>
      <strong>{t('common.selected', { count: selected.length })}</strong>
      <button style={{ marginLeft: 8 }}>{t('common.requestReview')}</button>
      <button style={{ marginLeft: 8 }}>{t('common.addTag')}</button>
      <button style={{ marginLeft: 8 }}>{t('common.addNote')}</button>
    </div>
    )}
  </div>
  );
}
