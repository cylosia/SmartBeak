
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

/**
 * Sanitize risk flags to only primitive values before rendering.
 * RiskFlag uses an index signature ([key: string]: unknown), so unknown fields
 * could include nested objects, functions, or PII. Strip everything that isn't
 * a string, number, or boolean to prevent accidental data exposure.
 */
function sanitizeRiskFlags(flags: RiskFlag[]): Record<string, string | number | boolean>[] {
  return flags.map(flag =>
    Object.fromEntries(
      Object.entries(flag).filter(
        (entry): entry is [string, string | number | boolean] => {
          const v = entry[1];
          return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
        }
      )
    )
  );
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
    <pre>{JSON.stringify(sanitizeRiskFlags(roi.risk_flags ?? []), null, 2)}</pre>
  </div>
  );
}
