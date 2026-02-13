
import React from 'react';
import { useTranslation } from '../lib/i18n';

export interface PortfolioRoi {
  total_production_cost?: number;
  total_monthly_revenue?: number;
  avg_payback_months?: number | null;
  roi_12mo?: number;
}

export interface RoiSummary {
  total_content_items?: number;
  portfolio_roi?: PortfolioRoi;
}

export interface PortfolioRoiDashboardProps {
  summary?: RoiSummary;
}

export function PortfolioRoiDashboard({ summary }: PortfolioRoiDashboardProps) {
  const { t, formatCurrency } = useTranslation();

  if (!summary) {
  return null;
  }

  const portfolioRoi = summary.portfolio_roi;

  return (
  <div>
    <h2>{t('roi.portfolioTitle')}</h2>
    <ul>
    <li>{t('roi.totalContentItems')}: {summary.total_content_items ?? 0}</li>
    <li>{t('roi.totalProductionCost')}: {formatCurrency(portfolioRoi?.total_production_cost ?? 0)}</li>
    <li>{t('roi.estimatedMonthlyRevenue')}: {formatCurrency(portfolioRoi?.total_monthly_revenue ?? 0)}</li>
    <li>
      {t('roi.avgPayback')}:{' '}
      {portfolioRoi?.avg_payback_months !== null && portfolioRoi?.avg_payback_months !== undefined
      ? t('roi.paybackMonths', { count: portfolioRoi.avg_payback_months })
      : t('roi.paybackNA')}
    </li>
    <li>{t('roi.estimated12MonthROI')}: {portfolioRoi?.roi_12mo ?? 0}%</li>
    </ul>
  </div>
  );
}
