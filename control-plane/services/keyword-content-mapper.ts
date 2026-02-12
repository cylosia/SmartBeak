/**
* P2-07: Use const array as single source of truth for role validation
*/
const VALID_ROLES = ['primary', 'secondary', 'supporting'] as const;
type KeywordContentRole = typeof VALID_ROLES[number];

/**
* Database interface for keyword content mapper
* P0-03: Fixed table name to content_keywords (matches migration)
*/
export interface Database {
  content_keywords: {
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
  // P2-06: Role type derived from const array
  role: KeywordContentRole;
}

/**
* Result of keyword to content mapping
* P2-06: Role type narrowed to match input constraint
*/
export interface MapKeywordToContentResult {
  keyword_id: string;
  content_id: string;
  role: KeywordContentRole;
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
  // P2-07: Runtime validation uses the same const array as the type
  if (!(VALID_ROLES as readonly string[]).includes(input.role)) {
  throw new Error(`role must be one of: ${VALID_ROLES.join(', ')}`);
  }

  // P0-03: Fixed table name to content_keywords (matches migration)
  return db.content_keywords.insert({
  keyword_id: input.keyword_id,
  content_id: input.content_id,
  role: input.role
  });
}
