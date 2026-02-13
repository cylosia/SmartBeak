
import React from 'react';
import { useTranslation } from '../lib/i18n';

export interface RiskFlag {
  [key: string]: unknown;
}

export interface RoiData {
  monthly_revenue?: number;
  roi?: number;
  risk_flags?: RiskFlag[];
}

export interface RiskAdjustedROIProps {
  roi?: RoiData;
}

export function RiskAdjustedROI({ roi }: RiskAdjustedROIProps) {
  const { t, formatCurrency } = useTranslation();

  if (!roi) return null;

  return (
  <div>
    <h3>{t('roi.roiTitle')}</h3>
    <p>{t('roi.monthlyRevenue')}: {formatCurrency(roi.monthly_revenue ?? 0)}</p>
    <p>{t('roi.roi')}: {roi.roi ?? 0}</p>
    <h4>{t('roi.riskFlags')}</h4>
    <pre>{JSON.stringify(roi.risk_flags ?? [], null, 2)}</pre>
  </div>
  );
}
