/**
* Podcast Metadata Adapter
* Handles podcast metadata extraction and normalization
*
* Provides utilities to adapt and validate podcast metadata from various sources,
* ensuring consistent structure for downstream processing.
*/

// Podcast metadata interface
export interface PodcastMetadata {
  title: string;
  description: string;
  author?: string | undefined;
  category?: string | undefined;
  explicit?: boolean | undefined;
  language?: string | undefined;
  imageUrl?: string | undefined;
  episodes?: EpisodeMetadata[] | undefined;
}

// Episode metadata interface
export interface EpisodeMetadata {
  title: string;
  description?: string | undefined;
  duration?: number | undefined;
  publishDate?: Date | undefined;
  audioUrl?: string | undefined;
}

/**
* Validates that a value is a non-empty string
*/
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
* Validates that a value is a valid URL string
*/
function isValidUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
  new URL(value);
  return true;
  } catch {
  return false;
  }
}

/**
* Validates episode metadata structure
*/
function isValidEpisodeMetadata(episode: unknown): episode is Record<string, unknown> {
  return episode !== null && typeof episode === 'object';
}

/**
* Adapt podcast metadata to internal format
*
* @param metadata - Raw podcast metadata
* @returns Normalized podcast metadata
*/
export function adaptPodcastMetadata(metadata: Record<string, unknown>): PodcastMetadata {
  if (!metadata || typeof metadata !== 'object') {
  throw new Error('Invalid metadata: expected object');
  }

  // Validate required fields
  if (!isNonEmptyString(metadata['title'])) {
  throw new Error('Invalid metadata: title is required and must be a non-empty string');
  }
  if (!isNonEmptyString(metadata['description'])) {
  throw new Error('Invalid metadata: description is required and must be a non-empty string');
  }

  return {
  title: metadata['title'],
  description: metadata['description'],
  author: isNonEmptyString(metadata['author']) ? metadata['author'] : undefined,
  category: isNonEmptyString(metadata['category']) ? metadata['category'] : undefined,
  explicit: metadata['explicit'] === true,
  language: isNonEmptyString(metadata['language']) ? metadata['language'] : undefined,
  imageUrl: isValidUrl(metadata['imageUrl']) ? metadata['imageUrl'] : undefined,
  episodes: Array.isArray(metadata['episodes'])
    ? metadata['episodes'].filter(isValidEpisodeMetadata).map(adaptEpisodeMetadata)
    : undefined,
  };
}

/**
* Adapt episode metadata with runtime validation
*/
function adaptEpisodeMetadata(episode: Record<string, unknown>): EpisodeMetadata {
  // Validate required title field
  if (!isNonEmptyString(episode['title'])) {
  throw new Error('Invalid episode metadata: title is required and must be a non-empty string');
  }

  // Safely parse duration as number
  let duration: number | undefined;
  if (typeof episode['duration'] === 'number' && !isNaN(episode['duration']) && episode['duration'] >= 0) {
  duration = episode['duration'];
  }

  // Safely parse publishDate as Date
  let publishDate: Date | undefined;
  if (isNonEmptyString(episode['publishDate'])) {
  const parsedDate = new Date(episode['publishDate']);
  if (!isNaN(parsedDate.getTime())) {
    publishDate = parsedDate;
  }
  }

  return {
  title: episode['title'],
  description: isNonEmptyString(episode['description']) ? episode['description'] : undefined,
  audioUrl: isValidUrl(episode['audioUrl']) ? episode['audioUrl'] : undefined,
  };
}

/**
* Validate podcast metadata
*/
export function validatePodcastMetadata(metadata: PodcastMetadata): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!metadata.title || metadata.title.length < 1) {
  errors.push('Title is required');
  }

  if (!metadata.description || metadata.description.length < 10) {
  errors.push('Description must be at least 10 characters');
  }

  return {
  valid: errors.length === 0,
  errors,
  };
}
