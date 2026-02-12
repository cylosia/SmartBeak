
import { KeywordGap } from './ahrefsGap';
export interface ContentIdea {
  title: string;
  intent: 'informational' | 'transactional' | 'navigational';
  effort: 'high' | 'medium' | 'low';
}

const TRANSACTIONAL_SIGNALS = ['buy', 'price', 'cost', 'cheap', 'deal', 'discount', 'purchase', 'order', 'shop'];
const NAVIGATIONAL_SIGNALS = ['login', 'sign in', 'official', 'website', 'homepage', 'app'];

function classifyIntent(phrase: string): ContentIdea['intent'] {
  const lower = phrase.toLowerCase();
  if (TRANSACTIONAL_SIGNALS.some(s => lower.includes(s))) return 'transactional';
  if (NAVIGATIONAL_SIGNALS.some(s => lower.includes(s))) return 'navigational';
  return 'informational';
}

function classifyEffort(volume: number): ContentIdea['effort'] {
  if (volume > 5000) return 'high';
  if (volume > 500) return 'medium';
  return 'low';
}

export function gapsToContentIdeas(gaps: KeywordGap[]): ContentIdea[] {
  return gaps.map(g => ({
  title: `Content idea for ${g.phrase}`,
  intent: classifyIntent(g.phrase),
  effort: classifyEffort(g.volume),
  }));
}
