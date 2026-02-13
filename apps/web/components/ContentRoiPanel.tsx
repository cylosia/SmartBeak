
import React from 'react';
import { useTranslation } from '../lib/i18n';

interface ContentRoiPanelProps {
  roi: {
    monthly_revenue_estimate: number;
    payback_months: number | null;
    roi_12mo: number;
  };
}

export function ContentRoiPanel({ roi }: ContentRoiPanelProps) {
  const { t, formatCurrency } = useTranslation();
  return (
  <div>
    <h3>{t('roi.contentTitle')}</h3>
    <ul>
    <li>{t('roi.estimatedMonthlyRevenue')}: {formatCurrency(roi.monthly_revenue_estimate)}</li>
    <li>
      {t('roi.paybackPeriod')}:{' '}
      {roi.payback_months !== null
      ? t('roi.paybackMonths', { count: roi.payback_months })
      : t('roi.paybackNA')}
    </li>
    <li>{t('roi.estimated12MonthROI')}: {roi.roi_12mo}%</li>
    </ul>
    <p style={{ fontSize: '0.85em', color: '#555' }}>
    {t('roi.advisory')}
    </p>
  </div>
  );
}
