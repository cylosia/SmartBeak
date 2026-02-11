import { z } from 'zod';
import fetch from 'node-fetch';

export async function ingestPinterestAnalytics(accessToken: string, pinId: string) {
  const res = await fetch(`https://api.pinterest.com/v5/pins/${pinId}/analytics?` +
    new URLSearchParams({
      metric_types: 'IMPRESSION,SAVE,OUTBOUND_CLICK'
    }).toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    throw new Error('Pinterest Analytics fetch failed');
  }
  const data = await res.json() as { IMPRESSION?: number; SAVE?: number; OUTBOUND_CLICK?: number };
  return {
    impressions: data.IMPRESSION || 0,
    saves: data.SAVE || 0,
    clicks: data.OUTBOUND_CLICK || 0
  };
}


export interface PinterestAnalytics {
  impressions: number;
  saves: number;
  clicks: number;
}
