
import { GetServerSideProps } from 'next';

import { RiskAdjustedROI, type RoiData } from '../../components/RiskAdjustedROI';
import { authFetch, apiUrl } from '../../lib/api-client';

interface RoiRiskProps {
  roi: RoiData;
}

export default function RoiRiskPage({ roi }: RoiRiskProps) {
  return (
  <main>
    <h1>Risk-adjusted ROI</h1>
    <RiskAdjustedROI roi={roi} />
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const assetId = ctx.params?.['assetId'];
  const res = await authFetch(apiUrl(`roi-risk/${assetId}`), { ctx });
  const roi = await res.json();
  return { props: { roi } };
};
