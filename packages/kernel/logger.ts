import { getRequestContext, RequestContext } from './request-context';

/**
* Structured Logger
*
* Provides structured logging with context support,
* multiple log levels, and custom handlers.
*

*/

// Re-export getRequestContext for convenience
export { getRequestContext };

// ============================================================================
// Type Definitions
// ============================================================================

/** Available log levels */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
* Log entry structure
*/
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Service name */
  service?: string | undefined;
  /** Request ID / Correlation ID */
  requestId?: string | undefined;
  correlationId?: string | undefined;
  /** User ID */
  userId?: string | undefined;
  /** Organization ID */
  orgId?: string | undefined;
  /** Trace ID */
  traceId?: string | undefined;
  /** Duration in milliseconds */
  duration?: number | undefined;
  /** Error details */
  error?: Error | undefined;
  /** Error message (for structured output) */
  errorMessage?: string | undefined;
  /** Error stack trace */
  errorStack?: string | undefined;
  /** Additional metadata */
  metadata?: Record<string, unknown> | undefined;
}

/** Log handler function type */
export type LogHandler = (entry: LogEntry) => void;

/** Logger options for getLogger */
export interface LoggerOptions {
  /** Service name */
  service: string;
  /** Correlation ID (overrides request context) */
  correlationId?: string | undefined;
  /** Additional context to include in every log */
  context?: Record<string, unknown> | undefined;
}

// ============================================================================
// Internal State (ARCH-FIX: Immutable handler management)
// ============================================================================

let handlers: LogHandler[] = [];
let handlersFrozen = false;

/**
 * Get immutable copy of handlers
 */
const getHandlers = (): readonly LogHandler[] => [...handlers];

/**
 * Add handler with immutability
 */
const addHandler = (handler: LogHandler): void => {
  if (handlersFrozen) {
    throw new Error('Cannot add handler after logger has been frozen');
  }
  handlers = [...handlers, handler];
};

/**
 * Freeze handler registration - call after initialization
 */
export function freezeHandlers(): void {
  handlersFrozen = true;
}

// ============================================================================
// Log Level Configuration
// ============================================================================

/**
* Get configured log level from environment
* Defaults to 'info' in production, 'debug' in development
*/
function getConfiguredLogLevel(): LogLevel {
  const envLevel = process.env['LOG_LEVEL']?.toLowerCase() as LogLevel;
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

  if (validLevels.includes(envLevel)) {
  return envLevel;
  }

  // Default based on environment
  return process.env['NODE_ENV'] === 'production' ? 'info' : 'debug';
}

/**
* Check if log level should be output
* @param level - Log level to check
*/
function shouldLog(level: LogLevel): boolean {
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
  const configuredLevel = getConfiguredLogLevel();
  return levels.indexOf(level) >= levels.indexOf(configuredLevel);
}

// ============================================================================
// Sensitive Data Redaction
// ============================================================================

/**
* Sensitive field patterns to redact
*/
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'apiKey',
  'api_key',
  'secret',
  'authorization',
  'auth',
  'cookie',
  'creditCard',
  'credit_card',
  'cvv',
  'ssn',
  'privateKey',
  'private_key',
];

/**
* Check if a key is sensitive
* @param key - Object key to check
*/
function isSensitiveField(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_FIELDS.some(field =>
  lowerKey.includes(field.toLowerCase())
  );
}

/**
* Redact sensitive data from an object
* @param obj - Object to redact
* @returns Redacted copy of the object
*/
function redactSensitiveData(obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') {
  return obj;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
  if (isSensitiveField(key)) {
    redacted[key] = '[REDACTED]';
  } else if (typeof value === 'object' && value !== null) {
    redacted[key] = redactSensitiveData(value as Record<string, unknown>);
  } else {
    redacted[key] = value;
  }
  }

  return redacted;
}

// ============================================================================
// Default Handler
// ============================================================================

/**
* Default console log handler
* P0-FIX: All logs go to stderr to ensure proper structured logging
* and prevent stdout pollution for CLI tools
* @param entry - Log entry to output
*/
function consoleHandler(entry: LogEntry): void {
  const { timestamp, level, message, service, requestId, correlationId, userId, orgId, traceId, duration, errorMessage, errorStack, metadata } = entry;

  // P0-FIX: Use stderr for all log levels to ensure structured logs don't pollute stdout
  // This is important for CLI tools and proper log aggregation
  const logFn = level === 'error' || level === 'fatal' || level === 'warn' 
    ? console["error"] 
    : console["error"]; // All logs to stderr for structured logging

  // Build structured log output
  const logOutput: Record<string, unknown> = {
  level: level.toUpperCase(),
  };

  if (service) logOutput["service"] = service;
  if (requestId || correlationId) logOutput["correlationId"] = correlationId || requestId;
  if (userId) logOutput["userId"] = userId;
  if (orgId) logOutput["orgId"] = orgId;
  if (traceId) logOutput["traceId"] = traceId;
  if (duration !== undefined) logOutput["duration"] = duration;
  if (errorMessage) logOutput["error"] = errorMessage;
  if (errorStack && process.env['LOG_LEVEL'] === 'debug') logOutput["stack"] = errorStack;
  if (metadata && Object.keys(metadata).length > 0) {
  logOutput["metadata"] = redactSensitiveData(metadata);
  }

  logFn(JSON.stringify(logOutput));
}

// ============================================================================
// Handler Management
// ============================================================================

/**
* Add a log handler
* ARCH-FIX: Returns cleanup function for proper resource management
* @param handler - Handler function to add
* @returns Function to remove the handler
*/
export function addLogHandler(handler: LogHandler): () => void {
  addHandler(handler);
  
  // Return cleanup function
  return () => {
    if (handlersFrozen) {
      throw new Error('Cannot remove handler after logger has been frozen');
    }
    handlers = handlers.filter(h => h !== handler);
  };
}

/**
* Remove all log handlers
* ARCH-FIX: Creates new empty array instead of mutating
*/
export function clearLogHandlers(): void {
  if (handlersFrozen) {
    throw new Error('Cannot clear handlers after logger has been frozen');
  }
  handlers = [];
}

// Add default handler (only if none exist)
if (handlers.length === 0) {
  addHandler(consoleHandler);
}

// ============================================================================
// Log Entry Creation
// ============================================================================

/**
* Create log entry with context
* @param level - Log level
* @param message - Log message
* @param metadata - Additional metadata
* @returns Complete log entry
*/
function createLogEntry(
  level: LogLevel,
  message: string,
  metadata?: Record<string, unknown>
): LogEntry {
  const context = getRequestContext();

  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: process.env['SERVICE_NAME'],
    requestId: context?.requestId,
    userId: context?.["userId"],
    orgId: context?.["orgId"],
    traceId: context?.["traceId"],
    duration: context ? Date.now() - context.startTime : undefined,
    metadata,
  };
}

// ============================================================================
// Log Functions
// ============================================================================

/**
* Log at debug level
* @param message - Log message
* @param metadata - Additional metadata
*/
export function debug(message: string, metadata?: Record<string, unknown>): void {
  if (process.env['LOG_LEVEL'] === 'debug') {
  const entry = createLogEntry('debug', message, metadata);
  getHandlers().forEach(h => h(entry));
  }
}

/**
* Log at info level
* @param message - Log message
* @param metadata - Additional metadata
*/
export function info(message: string, metadata?: Record<string, unknown>): void {
  const entry = createLogEntry('info', message, metadata);
  getHandlers().forEach(h => h(entry));
}

/**
* Log at warn level
* @param message - Log message
* @param metadata - Additional metadata
*/
export function warn(message: string, metadata?: Record<string, unknown>): void {
  const entry = createLogEntry('warn', message, metadata);
  getHandlers().forEach(h => h(entry));
}

/**
* Log at error level
* @param message - Log message
* @param err - Optional error object
* @param metadata - Additional metadata
*/
export function error(message: string, err?: Error, metadata?: Record<string, unknown>): void {
  const entry = createLogEntry('error', message, {
  ...metadata,
  error: err?.["message"],
  stack: err?.["stack"],
  });
  getHandlers().forEach(h => h(entry));
}

/**
* Log at fatal level
* @param message - Log message
* @param err - Optional error object
* @param metadata - Additional metadata
*/
export function fatal(message: string, err?: Error, metadata?: Record<string, unknown>): void {
  const entry = createLogEntry('fatal', message, {
  ...metadata,
  error: err?.["message"],
  stack: err?.["stack"],
  });
  getHandlers().forEach(h => h(entry));
}

// ============================================================================
// Enhanced Logger Class
// ============================================================================

/**
* Logger instance with bound context and correlation ID support
*/
export class Logger {
  private readonly context: Record<string, unknown>;

  /**
  * Create a new Logger instance
  * @param service - Service name
  * @param correlationId - Optional correlation ID
  * @param context - Additional context
  */
  constructor(
  private readonly service: string,
  private readonly correlationId?: string,
  context?: Record<string, unknown>
  ) {
  this.context = context || {};
  }

  /**
  * Get correlation ID from explicit value or request context
  */
  private getCorrelationId(): string | undefined {
  if (this["correlationId"]) {
    return this["correlationId"];
  }
  const ctx = getRequestContext();
  return ctx?.requestId || ctx?.["traceId"];
  }

  /**
  * Create log entry with service context
  */
  private createServiceLogEntry(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    err?: Error
  ): LogEntry {
    const context = getRequestContext();
    const correlationId = this.getCorrelationId();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: `[${this["service"]}] ${message}`,
      service: this["service"],
      metadata: { ...this.context, ...metadata },
    };
    
    if (correlationId) entry.requestId = correlationId;
    if (context?.["userId"]) entry.userId = context["userId"];
    if (context?.["orgId"]) entry.orgId = context["orgId"];
    if (context?.["traceId"]) entry.traceId = context["traceId"];
    if (context) entry.duration = Date.now() - context.startTime;
    
    if (err) {
      entry.error = err;
      entry.errorMessage = err.message;
    }
    
    return entry;
  }

  /**
  * Log at debug level
  * @param message - Log message
  * @param metadata - Additional metadata
  */
  debug(message: string, metadata?: Record<string, unknown>): void {
  if (shouldLog('debug')) {
    const entry = this.createServiceLogEntry('debug', message, metadata);
    getHandlers().forEach(h => h(entry));
  }
  }

  /**
  * Log at info level
  * @param message - Log message
  * @param metadata - Additional metadata
  */
  info(message: string, metadata?: Record<string, unknown>): void {
  if (shouldLog('info')) {
    const entry = this.createServiceLogEntry('info', message, metadata);
    getHandlers().forEach(h => h(entry));
  }
  }

  /**
  * Log at warn level
  * @param message - Log message
  * @param metadata - Additional metadata
  */
  warn(message: string, metadata?: Record<string, unknown>): void {
  if (shouldLog('warn')) {
    const entry = this.createServiceLogEntry('warn', message, metadata);
    getHandlers().forEach(h => h(entry));
  }
  }

  /**
  * Log at error level
  * @param message - Log message
  * @param err - Optional error object
  * @param metadata - Additional metadata
  */
  error(message: string, err?: Error, metadata?: Record<string, unknown>): void {
  if (shouldLog('error')) {
    const entry = this.createServiceLogEntry('error', message, metadata, err);
    getHandlers().forEach(h => h(entry));
  }
  }

  /**
  * Log at fatal level
  * @param message - Log message
  * @param err - Optional error object
  * @param metadata - Additional metadata
  */
  fatal(message: string, err?: Error, metadata?: Record<string, unknown>): void {
  if (shouldLog('fatal')) {
    const entry = this.createServiceLogEntry('fatal', message, metadata, err);
    getHandlers().forEach(h => h(entry));
  }
  }

  /**
  * Create a child logger with additional context
  * @param additionalContext - Additional context to include
  * @returns New Logger instance with merged context
  */
  child(additionalContext: Record<string, unknown>): Logger {
  return new Logger(
    this["service"],
    this["correlationId"],
    { ...this.context, ...additionalContext }
  );
  }
}

/**
* Get logger for service
* @param serviceOrOptions - Service name or LoggerOptions object
* @returns Logger instance
*/
export function getLogger(serviceOrOptions: string | LoggerOptions): Logger {
  if (typeof serviceOrOptions === 'string') {
  return new Logger(serviceOrOptions);
  }
  return new Logger(
  serviceOrOptions["service"],
  serviceOrOptions["correlationId"],
  serviceOrOptions.context
  );
}
