import fetch from 'node-fetch';

import { KeywordIngestionAdapter } from './types';

﻿


/**
* Custom error for not implemented features
*/
class NotImplementedError extends Error {
  constructor(message: string = 'Feature not yet implemented') {
  super(message);
  this.name = 'NotImplementedError';
  Object.setPrototypeOf(this, NotImplementedError.prototype);
  }
}

export const AhrefsRealAdapter: KeywordIngestionAdapter = {
  source: 'ahrefs',
  async fetch(domain: string): Promise<never> {
  // NOTE: Ahrefs API call implementation pending
  // Endpoint example (subject to plan):
  // GET https://apiv2.ahrefs.com?from=keywords_for_site&target=${domain}
  // This adapter throws NotImplementedError to prevent accidental production usage of mock data.
  throw new NotImplementedError('Ahrefs API integration not yet implemented');
  }
};
