import { z } from 'zod';
import { getLogger, getRequestContext } from '@kernel/logger';
import { abuseGuardConfig } from '@config';
import { sanitizeForLogging } from '@security/logger';

const logger = getLogger('abuseGuard');

/**
 * Abuse Guard Middleware
 * Content validation and abuse detection for user submissions
 */
// ============================================================================
// Zod Schemas
// ============================================================================
export const RiskCategorySchema = z.enum([
  'prohibited',
  'suspicious',
  'spam',
  'harassment',
  'illegal',
  'malware',
]);
export const AbuseCheckInputSchema = z.object({
  content: z.string().max(100000).optional(),
  riskFlags: z.array(z.string()).max(20).optional(),
  riskOverride: z.boolean().optional(),
  userId: z.string().min(1).max(256).optional(),
  ip: z.string().optional(),
}).strict();
export const AbuseCheckResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  riskScore: z.number().int().min(0).max(100),
  flags: z.array(z.string()).optional(),
});
export const CheckAbuseResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
});
// ============================================================================
// Error Types
// ============================================================================


export interface UserInfo {
  role?: string;
  id?: string;
}

export interface GuardRequest {
  body?: AbuseCheckInput;
  headers?: Record<string, string | string[]>;
  ip?: string;
  user?: UserInfo;
}

export interface GuardResponse {
  status: (code: number) => GuardResponse;
  json: (body: unknown) => void;
  send: (body: unknown) => void;
}

export interface RiskCategoryConfig {
  score: number;
  description: string;
  blockable: boolean;
}

export interface SuspiciousPattern {
  pattern: RegExp;
  score: number;
  name: string;
}

export interface RiskAssessment {
  maxRisk: number;
  criticalFlags: string[];
  highRiskFlags: string[];
}

export type RiskCategory = z.infer<typeof RiskCategorySchema>;

export type AbuseCheckInput = z.infer<typeof AbuseCheckInputSchema>;

export type AbuseCheckResult = z.infer<typeof AbuseCheckResultSchema>;

export type CheckAbuseResult = z.infer<typeof CheckAbuseResultSchema>;

export type NextFunction = () => void;

export class AbuseGuardError extends Error {
  code: string;
  riskScore: number;
  flags: string[];
  constructor(message: string, code: string, riskScore: number, flags: string[]) {
    super(message);
    this.code = code;
    this.riskScore = riskScore;
    this.flags = flags;
    this.name = 'AbuseGuardError';
  }
}
export class ProhibitedContentError extends AbuseGuardError {
  constructor(flags: string[]) {
    super(`Prohibited content detected: ${flags.join(', ')}. This content cannot be published.`, 'PROHIBITED_CONTENT', 100, flags);
    this.name = 'ProhibitedContentError';
  }
}
export class HighRiskContentError extends AbuseGuardError {
  constructor(flags: string[], riskScore: number) {
    super(`High risk content detected (${flags.join(', ')}). Requires explicit risk override to publish.`, 'HIGH_RISK_CONTENT', riskScore, flags);
    this.name = 'HighRiskContentError';
  }
}
export class ContentFlaggedError extends AbuseGuardError {
  constructor(reason: string, riskScore: number) {
    super(`Content flagged: ${reason}. Requires explicit risk override to publish.`, 'CONTENT_FLAGGED', riskScore, []);
    this.name = 'ContentFlaggedError';
  }
}
export class AbuseValidationError extends AbuseGuardError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 0, []);
    this.name = 'AbuseValidationError';
  }
}
// ============================================================================
// Constants
// ============================================================================
// Risk category scores
const RISK_CATEGORIES: Record<string, number> = {
  prohibited: 100, // Definitely prohibited
  suspicious: 50, // Needs review
  spam: 75, // Likely spam
  harassment: 90, // Harassment content
  illegal: 100, // Illegal content
  malware: 100, // Malware/phishing
};
// Suspicious content patterns for detection
// SECURITY FIX: Added 'g' flag with lastIndex reset to prevent state poisoning
const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  { pattern: /\b(buy now|click here|limited time)\b/gi, score: 10, name: 'spam_keywords' },
  { pattern: /<script\b/gi, score: 25, name: 'xss_attempt' },
  { pattern: /(javascript|data:|vbscript):/gi, score: 25, name: 'protocol_attack' },
  { pattern: /\b(casino|lottery|viagra|pills|weight loss)\b/gi, score: 15, name: 'spam_content' },
  { pattern: /\b(click.?below|order.?now|act.?now)\b/gi, score: 10, name: 'urgency_spam' },
  { pattern: /https?:\/\/(bit\.ly|t\.co|tinyurl)/gi, score: 10, name: 'url_shortener' },
];
// Content length thresholds
const CONTENT_LENGTH_THRESHOLDS = {
  warning: 10000, // Risk score +5
  high: 50000, // Risk score +20
  critical: 100000, // Risk score +50
};
// ============================================================================
// Risk Assessment Functions
// ============================================================================
/**
 * Check if a risk flag is a known category
 */
function isKnownRiskFlag(flag: string): boolean {
  return flag in RISK_CATEGORIES;
}
/**
 * Get the risk score for a flag
 */
function getRiskScore(flag: string): number {
  return isKnownRiskFlag(flag) ? (RISK_CATEGORIES[flag as keyof typeof RISK_CATEGORIES] ?? 25) : 25;
}
/**
 * Check if a flag is critical (score >= 100)
 */
function isCriticalFlag(flag: string): boolean {
  return getRiskScore(flag) >= 100;
}
/**
 * Check if a flag is high risk (score >= 50)
 */
function isHighRiskFlag(flag: string): boolean {
  return getRiskScore(flag) >= 50;
}

/**
 * SECURITY FIX: Check if user can override risk assessment
 * Only admin users are allowed to bypass risk checks
 * @param user - User info from request
 * @returns True if user can override risks
 */
function canOverrideRisk(user: UserInfo | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'admin';
}
/**
 * Check content for potential abuse
 *
 * @param content - Content to analyze
 * @returns Abuse check result with score and flags
 */
export function checkContentRisk(content: string | undefined): { allowed: boolean; riskScore: number; reason?: string | undefined; flags?: string[] | undefined } {
  if (!content) {
    return { allowed: true, riskScore: 0 };
  }
  let riskScore = 0;
  const flags: string[] = [];
  // Check for suspicious patterns
  for (const { pattern, score, name } of SUSPICIOUS_PATTERNS) {
    pattern.lastIndex = 0; // SECURITY FIX: Reset lastIndex to prevent state poisoning
    if (pattern.test(content)) {
      riskScore += score;
      if (!flags.includes(name)) {
        flags.push(name);
      }
    }
  }
  // Check content length (potential DoS)
  if (content.length > CONTENT_LENGTH_THRESHOLDS.critical) {
    riskScore += 50;
    flags.push('excessive_length_critical');
  }
  else if (content.length > CONTENT_LENGTH_THRESHOLDS.high) {
    riskScore += 20;
    flags.push('excessive_length');
  }
  else if (content.length > CONTENT_LENGTH_THRESHOLDS.warning) {
    riskScore += 5;
    flags.push('long_content');
  }
  // Cap risk score at 100
  riskScore = Math.min(riskScore, 100);
  return {
    allowed: riskScore < 50,
    reason: flags.length > 0 ? `Suspicious patterns: ${flags.join(', ')}` : undefined,
    riskScore,
    flags: flags.length > 0 ? flags : undefined,
  };
}
function assessRiskFlags(flags: string[]): RiskAssessment {
  let maxRisk = 0;
  const criticalFlags: string[] = [];
  const highRiskFlags: string[] = [];
  for (const flag of flags) {
    const score = getRiskScore(flag);
    maxRisk = Math.max(maxRisk, score);
    if (isCriticalFlag(flag)) {
      criticalFlags.push(flag);
    }
    else if (isHighRiskFlag(flag)) {
      highRiskFlags.push(flag);
    }
  }
  return { maxRisk, criticalFlags, highRiskFlags };
}
// ============================================================================
// Middleware
// ============================================================================
/**
 * Main abuse guard middleware
 *
 *
 * @param req - HTTP request object
 * @param _res - HTTP response object (unused but kept for middleware signature)
 * @param next - Next function to call if check passes
 * @throws {AbuseGuardError} When content is flagged or prohibited
 */
export async function abuseGuard(req: GuardRequest, _res: GuardResponse, next: NextFunction): Promise<void> {
  try {
    // Validate input structure
    const validated = AbuseCheckInputSchema.parse(req.body || {});
    // Check explicit risk flags
    if (validated.riskFlags && validated.riskFlags.length > 0) {
      const assessment = assessRiskFlags(validated.riskFlags);
      // Critical flags cannot be overridden
      if (assessment.criticalFlags.length > 0) {
        throw new ProhibitedContentError(assessment.criticalFlags);
      }
      // High risk requires explicit override AND admin role
      if (assessment.maxRisk >= 50 && !(validated.riskOverride && canOverrideRisk(req.user))) {
        throw new HighRiskContentError(validated.riskFlags, assessment.maxRisk);
      }
    }
    // Analyze content for risks
    const contentCheck = checkContentRisk(validated.content);
    if (!contentCheck.allowed && !(validated.riskOverride && canOverrideRisk(req.user))) {
      throw new ContentFlaggedError(contentCheck.reason || 'Unknown risk', contentCheck.riskScore);
    }
    // Log high-risk submissions for review (SECURITY FIX: Sanitize before logging)
    if (contentCheck.riskScore > 0 || (validated.riskFlags?.length ?? 0) > 0) {
      const logData = sanitizeForLogging({
        riskScore: contentCheck.riskScore,
        flags: validated.riskFlags,
        contentFlags: contentCheck.flags,
        userId: validated.userId,
        ip: validated.ip,
      });
      // P2-FIX: Use structured logger instead of console.warn
      logger.warn('High risk submission detected', logData as Record<string, unknown>);
    }
    next();
  }
  catch (error) {
    if (error instanceof z.ZodError) {
      throw new AbuseValidationError(`Invalid abuse check parameters: ${error.issues.map((e) => e.message).join(', ')}`);
    }
    throw error;
  }
}
// ============================================================================
// Standalone Check Function
// ============================================================================
/**
 * Check abuse without middleware pattern
 * Non-throwing version for programmatic use
 *
 * @param payload - Input payload to check
 * @returns Result indicating whether content is allowed
 */
export function checkAbuse(payload: unknown): CheckAbuseResult {
  try {
    const validated = AbuseCheckInputSchema.parse(payload);
    // Check risk flags
    if (validated.riskFlags?.some(isCriticalFlag)) {
      return { allowed: false, reason: 'Prohibited content detected' };
    }
    // Check content
    // P1-FIX: riskOverride now requires admin role — previously any caller could bypass
    const contentCheck = checkContentRisk(validated.content);
    if (!contentCheck.allowed) {
      // riskOverride is no longer honored in the standalone function
      // because there's no user context to verify admin role.
      // Use the middleware version for role-checked overrides.
      return { allowed: false, reason: contentCheck.reason };
    }
    return { allowed: true };
  }
  catch (error) {
    return { allowed: false, reason: 'Invalid payload' };
  }
}
/**
 * Check abuse with detailed result
 * Returns full risk assessment information
 *
 * @param payload - Input payload to check
 * @returns Detailed abuse check result
 */
export function checkAbuseDetailed(payload: unknown): AbuseCheckResult {
  try {
    const validated = AbuseCheckInputSchema.parse(payload);
    // Start with content analysis
    const contentCheck = checkContentRisk(validated.content);
    // Incorporate risk flags
    if (validated.riskFlags && validated.riskFlags.length > 0) {
      const assessment = assessRiskFlags(validated.riskFlags);
      // Combine risk scores (take the maximum)
      const combinedRisk = Math.max(contentCheck.riskScore, assessment.maxRisk);
      // Combine flags
      const combinedFlags = [
        ...(contentCheck.flags || []),
        ...validated.riskFlags,
      ];
      // P1-FIX: riskOverride no longer honored in checkAbuseDetailed because there
      // is no user context to verify admin role. The middleware version (abuseGuard)
      // correctly requires canOverrideRisk(req.user) before honoring riskOverride.
      // Without a role check here, any caller could bypass risk assessment by
      // setting riskOverride:true in the payload.
      return {
        allowed: combinedRisk < 50,
        reason: combinedFlags.length > 0 ? `Flags: ${combinedFlags.join(', ')}` : undefined,
        riskScore: combinedRisk,
        flags: combinedFlags.length > 0 ? combinedFlags : undefined,
      };
    }
    return contentCheck as AbuseCheckResult;
  }
  catch (error) {
    return {
      allowed: false,
      reason: 'Invalid payload',
      riskScore: 100,
      flags: ['validation_error'],
    };
  }
}
