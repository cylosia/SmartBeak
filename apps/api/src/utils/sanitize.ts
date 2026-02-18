/**
 * Sanitization utilities for safe inclusion of external values in log messages.
 */

/** Maximum characters of a videoId to include in log messages */
const MAX_VIDEO_ID_LOG_LENGTH = 20;

/**
 * Sanitize a YouTube videoId for safe inclusion in log messages.
 *
 * Strips non-word characters (only [A-Za-z0-9_-] are kept) and truncates to
 * prevent log injection. Returns '<invalid>' if sanitization produces an empty
 * string so the log entry is always non-empty and clearly flags the problem.
 */
export function sanitizeVideoIdForLog(videoId: string): string {
  return videoId.slice(0, MAX_VIDEO_ID_LOG_LENGTH).replace(/[^\w-]/g, '') || '<invalid>';
}
