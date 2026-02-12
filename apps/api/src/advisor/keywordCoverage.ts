/**
 * P1-09: Re-export from canonical location to prevent duplicate implementations.
 * The canonical implementation lives in apps/api/src/keywords/keywords.ts.
 */
export { keywordCoverageForDomain } from '../keywords/keywords';
export type { KeywordCoverageResult } from '../keywords/keywords';
