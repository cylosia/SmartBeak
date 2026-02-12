
import React from 'react';

interface BuyerSeoReport {
  domain: string;
  completeness_score: number;
  page_count: number;
  cluster_count: number;
  freshness_ratio: number;
  notes: string[];
}

interface BuyerSeoReportViewProps {
  report: BuyerSeoReport;
}

export function BuyerSeoReportView({ report }: BuyerSeoReportViewProps) {
  return (
  <div>
    <h2>SEO Buyer Report</h2>
    <p><strong>Domain:</strong> {report.domain}</p>
    <p><strong>Completeness Score:</strong> {report.completeness_score} / 100</p>
    <ul>
    <li>Pages: {report.page_count}</li>
    <li>Clusters: {report.cluster_count}</li>
    <li>Freshness Ratio: {report.freshness_ratio}</li>
    </ul>
    <h4>Notes</h4>
    <ul>
    {report.notes.map((n, i) => <li key={`note-${i}`}>{n}</li>)}
    </ul>
  </div>
  );
}
