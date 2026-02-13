import { useTranslation } from '../lib/i18n';

export function ContentFilters({ onFilter }: { onFilter: (f: Record<string, string>) => void }) {
  const { t } = useTranslation();
  return (
  <div role="group" aria-label={t('a11y.contentFilters')} style={{ marginBottom: 16 }}>
    <label htmlFor="filter-type" style={{ marginRight: 4 }}>{t('filters.type')}:</label>
    <select
      id="filter-type"
      aria-label={t('a11y.filterByType')}
      onChange={(e) => onFilter({ type: (e.target as HTMLSelectElement).value })}
    >
    <option value=''>{t('filters.allTypes')}</option>
    <option value='web'>{t('content.types.web')}</option>
    <option value='blog'>{t('content.types.blog')}</option>
    <option value='image'>{t('content.types.image')}</option>
    <option value='video'>{t('content.types.video')}</option>
    <option value='audio'>{t('content.types.audio')}</option>
    <option value='social'>{t('content.types.social')}</option>
    </select>
    <label htmlFor="filter-status" style={{ marginLeft: 16, marginRight: 4 }}>{t('filters.status')}:</label>
    <select
      id="filter-status"
      aria-label={t('a11y.filterByStatus')}
      style={{ marginLeft: 8 }}
      onChange={(e) => onFilter({ status: (e.target as HTMLSelectElement).value })}
    >
    <option value=''>{t('filters.allStatuses')}</option>
    <option value='draft'>{t('content.statuses.draft')}</option>
    <option value='published'>{t('content.statuses.published')}</option>
    <option value='archived'>{t('content.statuses.archived')}</option>
    </select>
  </div>
  );
}
