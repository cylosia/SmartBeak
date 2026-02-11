
import { KeywordGap } from './ahrefsGap';
export interface ContentIdea {
  title: string;
  intent: 'informational' | 'transactional' | 'navigational';
  effort: 'high' | 'medium' | 'low';
}

export function gapsToContentIdeas(gaps: KeywordGap[]): ContentIdea[] {
  return gaps.map(g => ({
  title: `Content idea for ${g.phrase}`,
  intent: 'informational',
  effort: g.volume > 5000 ? 'high' : 'medium'
  }));
}
