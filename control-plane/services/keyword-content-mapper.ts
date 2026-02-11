/**
* Database interface for keyword content mapper
*/
export interface Database {
  keyword_content_map: {
  insert: (data: {
    keyword_id: string;
    content_id: string;
    role: string;
  }) => Promise<MapKeywordToContentResult>;
  };
}

/**
* Input for mapping keyword to content
*/
export interface MapKeywordToContentInput {
  keyword_id: string;
  content_id: string;
  role: 'primary' | 'secondary' | 'supporting';
}

/**
* Result of keyword to content mapping
*/
export interface MapKeywordToContentResult {
  keyword_id: string;
  content_id: string;
  role: string;
}

/**
* Maps a keyword to content with validation
* @param db - Database instance
* @param input - Mapping input
* @returns Promise resolving to the mapping result
*/
export async function mapKeywordToContent(
  db: Database,
  input: MapKeywordToContentInput
): Promise<MapKeywordToContentResult> {
  // Validate inputs
  if (!input.keyword_id || typeof input.keyword_id !== 'string') {
  throw new Error('keyword_id is required and must be a string');
  }
  if (!input.content_id || typeof input.content_id !== 'string') {
  throw new Error('content_id is required and must be a string');
  }
  const validRoles = ['primary', 'secondary', 'supporting'];
  if (!validRoles.includes(input.role)) {
  throw new Error(`role must be one of: ${validRoles.join(', ')}`);
  }

  // Requires human action in UI; no automation here.
  return db.keyword_content_map.insert({
  keyword_id: input.keyword_id,
  content_id: input.content_id,
  role: input.role
  });
}
